import { NextRequest, NextResponse } from 'next/server';
import { createPdfExport, pool } from '@/lib/db';
import { addJob } from '@/lib/job-queue';
import { decryptJson } from '@/lib/encryption';
import mysql from 'mysql2/promise';
import { normalizeAccount } from '@/lib/pdf-shared';

// Increase timeout for large exports
export const maxDuration = 300; // 5 minutes (Vercel limit, but we'll process async)

/**
 * POST /api/export-pdfs-bulk
 * Start a bulk PDF export job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tab } = body;

    if (!tab || !['quarterly', 'play', 'no-play'].includes(tab)) {
      return NextResponse.json(
        { success: false, error: 'Invalid tab. Must be quarterly, play, or no-play' },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();
    
    try {
      // Get total count of members to export
      let countQuery: string;
      
      if (tab === 'quarterly') {
        countQuery = `
          SELECT COUNT(DISTINCT latest_batch.account_number) as total
          FROM (
            SELECT 
              qus.account_number,
              gb.id as batch_id,
              ROW_NUMBER() OVER (PARTITION BY qus.account_number ORDER BY gb.generation_date DESC) as rn
            FROM quarterly_user_statements qus
            INNER JOIN generation_batches gb ON qus.batch_id = gb.id
          ) as latest_batch
          WHERE latest_batch.rn = 1
        `;
      } else if (tab === 'play') {
        countQuery = `
          SELECT COUNT(DISTINCT latest_play.account_number) as total
          FROM (
            SELECT 
              npp.account_number,
              npb.id as batch_id,
              ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
            FROM no_play_players npp
            INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
            WHERE npp.no_play_status = 'Play'
          ) as latest_play
          WHERE latest_play.rn = 1
        `;
      } else {
        countQuery = `
          SELECT COUNT(DISTINCT latest_no_play.account_number) as total
          FROM (
            SELECT 
              npp.account_number,
              npb.id as batch_id,
              ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
            FROM no_play_players npp
            INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
            WHERE npp.no_play_status != 'Play'
          ) as latest_no_play
          WHERE latest_no_play.rn = 1
        `;
      }

      const [countRows] = await connection.execute<mysql.RowDataPacket[]>(countQuery);
      const totalMembers = countRows[0]?.total || 0;

      if (totalMembers === 0) {
        return NextResponse.json(
          { success: false, error: 'No members found to export' },
          { status: 404 }
        );
      }

      // Get all members to export
      let query: string;
      
      if (tab === 'quarterly') {
        query = `
          SELECT 
            m.account_number,
            COALESCE(m.title, '') as title,
            COALESCE(m.first_name, '') as first_name,
            COALESCE(m.last_name, '') as last_name,
            latest_batch.batch_id as batch_id
          FROM members m
          INNER JOIN (
            SELECT 
              qus.account_number,
              gb.id as batch_id,
              ROW_NUMBER() OVER (PARTITION BY qus.account_number ORDER BY gb.generation_date DESC) as rn
            FROM quarterly_user_statements qus
            INNER JOIN generation_batches gb ON qus.batch_id = gb.id
          ) as latest_batch ON m.account_number = latest_batch.account_number AND latest_batch.rn = 1
          ORDER BY m.account_number
        `;
      } else if (tab === 'play') {
        query = `
          SELECT 
            latest_play.account_number,
            latest_play.batch_id,
            latest_play.player_data
          FROM (
            SELECT 
              npp.account_number,
              npb.id as batch_id,
              npp.player_data,
              ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
            FROM no_play_players npp
            INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
            WHERE npp.no_play_status = 'Play'
          ) as latest_play
          WHERE latest_play.rn = 1
          ORDER BY latest_play.account_number
        `;
      } else {
        query = `
          SELECT 
            latest_no_play.account_number,
            latest_no_play.batch_id,
            latest_no_play.player_data
          FROM (
            SELECT 
              npp.account_number,
              npb.id as batch_id,
              npp.player_data,
              ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
            FROM no_play_players npp
            INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
            WHERE npp.no_play_status != 'Play'
          ) as latest_no_play
          WHERE latest_no_play.rn = 1
          ORDER BY latest_no_play.account_number
        `;
      }

      const [rows] = await connection.execute<mysql.RowDataPacket[]>(query);
      const members = rows.map(row => {
        let name = '';
        
        if (tab === 'quarterly') {
          name = [row.title, row.first_name, row.last_name].filter(Boolean).join(' ') || row.account_number;
        } else {
          let firstName = '';
          let lastName = '';
          
          if (row.player_data) {
            try {
              // Decrypt the player data (handles both encrypted and legacy unencrypted data)
              const playerData = decryptJson(row.player_data);
              const playerInfo = playerData.playerInfo || {};
              firstName = playerInfo.firstName || '';
              lastName = playerInfo.lastName || '';
            } catch (e) {
              // Ignore parse errors
            }
          }
          
          name = [firstName, lastName].filter(Boolean).join(' ').trim() || row.account_number;
        }
        
        return {
          account: row.account_number,
          batchId: row.batch_id,
          name: name
        };
      });

      // Create export job
      const exportId = await createPdfExport(tab, totalMembers);

      // Add job to queue
      await addJob(
        'pdf-export',
        {
          exportId,
          tab,
          members,
        },
        {
          queue_name: 'pdf-export',
          priority: 0,
          max_attempts: 3,
        }
      );

      return NextResponse.json({
        success: true,
        exportId,
        totalMembers,
        message: 'Export job queued. Check status endpoint for progress.'
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error starting bulk export:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start export job' },
      { status: 500 }
    );
  }
}











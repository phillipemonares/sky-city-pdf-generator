import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import mysql from 'mysql2/promise';

// Increase timeout for large exports
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tab, limit, offset } = body;

    if (!tab || !['quarterly', 'play', 'no-play'].includes(tab)) {
      return NextResponse.json(
        { success: false, error: 'Invalid tab. Must be quarterly, play, or no-play' },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();
    
    try {
      let query: string;
      let params: any[];

      if (tab === 'quarterly') {
        query = `
          SELECT 
            m.account_number,
            m.title,
            m.first_name,
            m.last_name,
            m.latest_batch_id as batch_id
          FROM members m
          WHERE m.latest_batch_id IS NOT NULL
          ORDER BY m.account_number
          LIMIT ? OFFSET ?
        `;
        params = [limit || 1000, offset || 0];
      } else if (tab === 'play') {
        query = `
          SELECT DISTINCT
            p.account_number,
            NULL as title,
            p.first_name,
            p.last_name,
            p.batch_id
          FROM no_play_players p
          WHERE p.no_play_status = 'Play' 
            AND p.batch_id IS NOT NULL
          ORDER BY p.account_number
          LIMIT ? OFFSET ?
        `;
        params = [limit || 1000, offset || 0];
      } else {
        query = `
          SELECT DISTINCT
            p.account_number,
            NULL as title,
            p.first_name,
            p.last_name,
            p.batch_id
          FROM no_play_players p
          WHERE p.no_play_status != 'Play' 
            AND p.batch_id IS NOT NULL
          ORDER BY p.account_number
          LIMIT ? OFFSET ?
        `;
        params = [limit || 1000, offset || 0];
      }

      const [rows] = await connection.execute<mysql.RowDataPacket[]>(query, params);

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No members found to export' },
          { status: 404 }
        );
      }

      // Return the list of members to export (client will handle PDF generation)
      return NextResponse.json({
        success: true,
        members: rows.map(row => ({
          account: row.account_number,
          batchId: row.batch_id,
          name: [row.title, row.first_name, row.last_name].filter(Boolean).join(' ') || row.account_number
        })),
        count: rows.length
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in export-pdfs-batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch members for export' },
      { status: 500 }
    );
  }
}























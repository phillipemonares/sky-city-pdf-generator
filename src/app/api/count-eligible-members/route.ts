import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import mysql from 'mysql2/promise';
import { decrypt } from '@/lib/encryption';
import { normalizeAccount } from '@/lib/pdf-shared';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const emailType = searchParams.get('emailType');
    const search = searchParams.get('search') || '';
    const isPostal = searchParams.get('is_postal');

    if (!emailType || !['quarterly', 'play', 'no-play'].includes(emailType)) {
      return NextResponse.json(
        { success: false, error: 'Valid emailType is required (quarterly, play, no-play)' },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();
    
    try {
      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Get accounts that already received emails today
      const [sentTodayRows] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT DISTINCT recipient_account 
         FROM email_tracking 
         WHERE email_type = ? 
           AND status = 'sent' 
           AND sent_at >= ? 
           AND sent_at < ?`,
        [emailType, today, tomorrow]
      );
      
      const alreadySentAccounts = new Set(
        sentTodayRows.map(row => normalizeAccount(row.recipient_account))
      );

      // Build query to get eligible members
      let accountQuery: string;
      const conditions: string[] = [];
      const values: any[] = [];

      if (emailType === 'quarterly') {
        // Use a subquery to get latest batch per account, similar to export-pdfs-bulk
        accountQuery = `
          SELECT DISTINCT 
            m.account_number,
            m.is_email,
            m.email,
            m.is_postal
          FROM members m
          INNER JOIN (
            SELECT 
              qus.account_number,
              gb.id as batch_id,
              ROW_NUMBER() OVER (PARTITION BY qus.account_number ORDER BY gb.generation_date DESC) as rn
            FROM quarterly_user_statements qus
            INNER JOIN generation_batches gb ON qus.batch_id = gb.id
          ) as latest_batch ON m.account_number = latest_batch.account_number AND latest_batch.rn = 1
          WHERE COALESCE(m.is_email, 0) = 1
            AND m.email IS NOT NULL
            AND m.email != ""
        `;
        
        if (isPostal !== null && isPostal !== undefined) {
          accountQuery += ` AND m.is_postal = ${isPostal === '1' ? 1 : 0}`;
        }
      } else if (emailType === 'play') {
        accountQuery = `
          SELECT DISTINCT latest_play.account_number, latest_play.is_email, latest_play.player_data
          FROM (
            SELECT 
              npp.account_number,
              npp.is_email,
              npp.player_data,
              ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
            FROM no_play_players npp
            INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
            WHERE npp.no_play_status = 'Play'
          ) as latest_play
          WHERE latest_play.rn = 1
            AND COALESCE(latest_play.is_email, 0) = 1
        `;
      } else {
        accountQuery = `
          SELECT DISTINCT latest_no_play.account_number, latest_no_play.is_email, latest_no_play.player_data
          FROM (
            SELECT 
              npp.account_number,
              npp.is_email,
              npp.player_data,
              ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
            FROM no_play_players npp
            INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
            WHERE npp.no_play_status != 'Play'
          ) as latest_no_play
          WHERE latest_no_play.rn = 1
            AND COALESCE(latest_no_play.is_email, 0) = 1
        `;
      }

      // Fetch all eligible account numbers
      const [accountRows] = await connection.execute<mysql.RowDataPacket[]>(accountQuery, values);
      
      // Decrypt and normalize account numbers, then filter out those already sent today
      // Also check if they have email address (for play/no-play, email is in player_data)
      let eligibleCount = 0;
      for (const row of accountRows) {
        try {
          const decryptedAccount = decrypt(row.account_number);
          const normalizedAccount = normalizeAccount(decryptedAccount);
          
          // Skip if already sent today
          if (alreadySentAccounts.has(normalizedAccount)) {
            continue;
          }

          // For quarterly, check if email exists and is not empty
          if (emailType === 'quarterly') {
            const email = decrypt(row.email || '');
            if (!email || email.trim() === '') {
              continue; // Skip if no email
            }
          }
          
          // For play/no-play, check if email exists in player_data
          if (emailType === 'play' || emailType === 'no-play') {
            try {
              const { decryptJson } = await import('@/lib/encryption');
              const playerData = decryptJson<any>(row.player_data);
              const email = playerData?.playerInfo?.email || '';
              if (!email || email.trim() === '') {
                continue; // Skip if no email
              }
            } catch (error) {
              // Skip if can't parse player_data
              continue;
            }
          }

          eligibleCount++;
        } catch (error) {
          // Skip if decryption fails
          console.error('Error decrypting account number:', error);
        }
      }

      return NextResponse.json({
        success: true,
        count: eligibleCount,
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error counting eligible members:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to count eligible members' },
      { status: 500 }
    );
  }
}


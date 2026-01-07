import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import mysql from 'mysql2/promise';
import { normalizeAccount } from '@/lib/pdf-shared';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accounts, emailType } = body;

    if (!accounts || !Array.isArray(accounts)) {
      return NextResponse.json(
        { success: false, error: 'Accounts array is required' },
        { status: 400 }
      );
    }

    if (!emailType || !['quarterly', 'play', 'no-play', 'pre-commitment', 'other'].includes(emailType)) {
      return NextResponse.json(
        { success: false, error: 'Valid emailType is required' },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();
    
    try {
      // Normalize all accounts for comparison
      const normalizedAccounts = accounts.map(acc => normalizeAccount(acc)).filter(Boolean);
      
      if (normalizedAccounts.length === 0) {
        return NextResponse.json({
          success: true,
          alreadySentMap: {},
        });
      }

      // Check which accounts already received emails (by account only, not batch)
      const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT DISTINCT recipient_account 
         FROM email_tracking 
         WHERE email_type = ? 
           AND status = 'sent' 
           AND recipient_account IS NOT NULL
           AND recipient_account IN (${normalizedAccounts.map(() => '?').join(',')})`,
        [emailType, ...normalizedAccounts]
      );

      // Create a set of accounts that already have emails sent
      const alreadySentSet = new Set<string>();
      rows.forEach(row => {
        const account = normalizeAccount(row.recipient_account);
        if (account) {
          alreadySentSet.add(account);
        }
      });

      // Create a map of original accounts to whether they've been sent
      const alreadySentMap: Record<string, boolean> = {};
      accounts.forEach(account => {
        const normalized = normalizeAccount(account);
        alreadySentMap[account] = normalized ? alreadySentSet.has(normalized) : false;
      });

      return NextResponse.json({
        success: true,
        alreadySentMap,
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error checking emails sent by account:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check emails sent by account' },
      { status: 500 }
    );
  }
}






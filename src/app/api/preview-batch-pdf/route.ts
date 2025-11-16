import { NextRequest, NextResponse } from 'next/server';
import { getBatchById, getAccountFromBatch } from '@/lib/db';
import { generatePreviewHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

// Increase max duration for large data processing
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const account = searchParams.get('account');

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId parameter is required' },
        { status: 400 }
      );
    }

    // Get batch metadata
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get quarterlyData - try from batch metadata first, then reconstruct if needed
    let quarterlyData = null;
    
    // First, try to get from batch metadata
    try {
      const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT quarterly_data FROM generation_batches WHERE id = ?`,
        [batchId]
      );
      
      if (batchRows.length > 0 && batchRows[0].quarterly_data) {
        const metadata = JSON.parse(batchRows[0].quarterly_data);
        quarterlyData = metadata.quarterlyData || null;
      }
    } catch (error: any) {
      // Column might not exist (for existing batches created before this feature)
      if (error.code !== 'ER_BAD_FIELD_ERROR') {
        console.log('Could not fetch quarterly_data from batch metadata:', error);
      }
    }
    
    // If not found, try to get from stored records (old format)
    if (!quarterlyData) {
      try {
        const [sampleRow] = await pool.execute<mysql.RowDataPacket[]>(
          `SELECT data FROM quarterly_user_statements WHERE batch_id = ? LIMIT 1`,
          [batchId]
        );
        if (sampleRow.length > 0) {
          const sampleData = JSON.parse(sampleRow[0].data) as { quarterlyData?: any };
          if (sampleData.quarterlyData) {
            quarterlyData = sampleData.quarterlyData;
          }
        }
      } catch (error) {
        // Ignore
      }
    }
    
    // If still not found, reconstruct from all cashless statements
    if (!quarterlyData) {
      try {
        const [allRows] = await pool.execute<mysql.RowDataPacket[]>(
          `SELECT data FROM quarterly_user_statements WHERE batch_id = ?`,
          [batchId]
        );
        
        const cashlessPlayersMap = new Map<string, any>();
        
        for (const row of allRows) {
          try {
            const userData = JSON.parse(row.data) as { cashless_statement?: any };
            
            if (userData.cashless_statement) {
              const account = userData.cashless_statement.playerInfo?.playerAccount;
              if (account && !cashlessPlayersMap.has(account)) {
                cashlessPlayersMap.set(account, userData.cashless_statement);
              }
            }
          } catch (error) {
            // Ignore parsing errors
          }
        }
        
        // Reconstruct quarterlyData from collected cashless players
        if (cashlessPlayersMap.size > 0) {
          const allCashlessPlayers = Array.from(cashlessPlayersMap.values());
          quarterlyData = {
            quarter: batch.quarter,
            year: batch.year,
            players: allCashlessPlayers,
            monthlyBreakdown: [], // We don't have monthly breakdown in stored data, but it's not critical for preview
          };
        }
      } catch (error) {
        console.error('Error reconstructing quarterlyData:', error);
      }
    }
    
    if (!quarterlyData) {
      return NextResponse.json(
        { success: false, error: 'No quarterly data found in batch' },
        { status: 400 }
      );
    }

    // Format dates from batch to DD/MM/YYYY format for statementPeriod
    const formatDateToDDMMYYYY = (date: Date | null): string | null => {
      if (!date) return null;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // If batch has start_date and end_date, use them to populate quarterlyData.statementPeriod
    if (batch.start_date && batch.end_date) {
      const startDateFormatted = formatDateToDDMMYYYY(batch.start_date);
      const endDateFormatted = formatDateToDDMMYYYY(batch.end_date);
      
      if (startDateFormatted && endDateFormatted) {
        quarterlyData = {
          ...quarterlyData,
          statementPeriod: {
            startDate: startDateFormatted,
            endDate: endDateFormatted,
          },
        };
      }
    }

    // Determine target account
    let targetAccountNumber: string;
    if (account) {
      targetAccountNumber = normalizeAccount(account);
    } else {
      // If no specific account requested, we need to get any account from the batch
      // For efficiency, we'll use the quarterly data query result's account
      return NextResponse.json(
        { success: false, error: 'Account parameter is required for preview' },
        { status: 400 }
      );
    }

    // Get the specific account data (optimized single query)
    const matchedAccount = await getAccountFromBatch(batchId, targetAccountNumber);
    
    if (!matchedAccount) {
      return NextResponse.json(
        { success: false, error: 'Requested account was not found in the batch' },
        { status: 404 }
      );
    }

    // Extract the target player data
    const targetPlayer = matchedAccount.account_data;

    // Ensure cashless is only included if it exists
    if (!targetPlayer.cashless) {
      console.log(`Cashless data not found for account ${targetPlayer.account}, excluding from preview`);
    }

    // Convert logos to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Convert play-header to base64 for pre-commitment section
    const playHeaderPath = join(process.cwd(), 'public', 'play-header.png');
    const playHeaderBuffer = readFileSync(playHeaderPath);
    const playHeaderBase64 = playHeaderBuffer.toString('base64');
    const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;

    const html = generatePreviewHTML(targetPlayer, quarterlyData, logoDataUrl, playHeaderDataUrl);

    // Add print button to the HTML
    const htmlWithPrintButton = html.replace(
      '<body',
      `<body>
        <style>
          .print-button-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
          }
          .print-button {
            background: #2563eb;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            transition: background 0.2s;
          }
          .print-button:hover {
            background: #1d4ed8;
          }
          @media print {
            .print-button-container {
              display: none;
            }
          }
        </style>
        <div class="print-button-container">
          <button class="print-button" onclick="window.print()">🖨️ Print</button>
        </div>
      <body`
    ).replace('<body>', '');

    return new NextResponse(htmlWithPrintButton, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    });

  } catch (error) {
    console.error('Error generating preview from batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate preview from batch' },
      { status: 500 }
    );
  }
}
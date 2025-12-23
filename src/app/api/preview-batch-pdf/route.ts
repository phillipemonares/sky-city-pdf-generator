import { NextRequest, NextResponse } from 'next/server';
import { getBatchById, getAccountFromBatch } from '@/lib/db';
import { generatePreviewHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { decryptJson } from '@/lib/encryption';
import { readFileSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';
import { QuarterlyData } from '@/types/player-data';

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

    // Log the request parameters for debugging
    console.log('[preview-batch-pdf] Request params:', { batchId, account });

    // Get batch metadata
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get quarterlyData - try from batch metadata first, then reconstruct if needed
    let quarterlyData: QuarterlyData | null = null;
    
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
          // Use decryptJson to handle both encrypted and legacy unencrypted data
          const sampleData = decryptJson<{ quarterlyData?: any }>(sampleRow[0].data);
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
            // Decrypt the user data (handles both encrypted and legacy unencrypted data)
            const userData = decryptJson<{ cashless_statement?: any }>(row.data);
            
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
      console.error('[preview-batch-pdf] No quarterly data found for batch:', batchId);
      // Try to create a minimal quarterlyData structure from batch info
      // This allows preview to work even if quarterlyData wasn't stored properly
      const formatDateToDDMMYYYY = (date: Date | null): string | null => {
        if (!date) return null;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };
      
      const startDateFormatted = batch.start_date ? formatDateToDDMMYYYY(batch.start_date) : null;
      const endDateFormatted = batch.end_date ? formatDateToDDMMYYYY(batch.end_date) : null;
      
      quarterlyData = {
        quarter: batch.quarter || 0,
        year: batch.year || new Date().getFullYear(),
        players: [],
        monthlyBreakdown: [],
        ...(startDateFormatted && endDateFormatted ? {
          statementPeriod: {
            startDate: startDateFormatted,
            endDate: endDateFormatted,
          }
        } : {}),
      };
      
      console.warn('[preview-batch-pdf] Using minimal quarterlyData structure:', {
        quarter: quarterlyData.quarter,
        year: quarterlyData.year,
        hasStatementPeriod: !!quarterlyData.statementPeriod,
      });
    }

    if (!quarterlyData) {
      return NextResponse.json(
        { success: false, error: 'Unable to load quarterly data for batch' },
        { status: 500 }
      );
    }

    console.log('[preview-batch-pdf] Quarterly data found:', {
      hasQuarterlyData: !!quarterlyData,
      quarter: quarterlyData.quarter,
      year: quarterlyData.year,
      playersCount: quarterlyData.players?.length || 0,
    });

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
      // Handle account format that might include colon (e.g., "105101445:1")
      // Extract just the account number part before the colon
      const accountPart = account.split(':')[0];
      targetAccountNumber = normalizeAccount(accountPart);
      console.log('[preview-batch-pdf] Account lookup:', {
        originalAccount: account,
        accountPart,
        normalizedAccount: targetAccountNumber,
      });
    } else {
      // If no specific account requested, we need to get any account from the batch
      // For efficiency, we'll use the quarterly data query result's account
      return NextResponse.json(
        { success: false, error: 'Account parameter is required for preview' },
        { status: 400 }
      );
    }

    // Get the specific account data (optimized single query)
    // Try with normalized account first, then try with original account part
    let matchedAccount = await getAccountFromBatch(batchId, targetAccountNumber);
    
    // If not found, try with the original account part (before normalization)
    if (!matchedAccount && account) {
      const accountPart = account.split(':')[0];
      matchedAccount = await getAccountFromBatch(batchId, accountPart);
    }
    
    if (!matchedAccount) {
      console.error('[preview-batch-pdf] Account not found:', {
        batchId,
        requestedAccount: account,
        normalizedAccount: targetAccountNumber,
      });
      return NextResponse.json(
        { success: false, error: 'Requested account was not found in the batch' },
        { status: 404 }
      );
    }

    console.log('[preview-batch-pdf] Account found:', {
      account: matchedAccount.account_number,
      hasActivity: matchedAccount.has_activity,
      hasPreCommitment: matchedAccount.has_pre_commitment,
      hasCashless: matchedAccount.has_cashless,
    });

    // Extract the target player data
    const targetPlayer = matchedAccount.account_data;
    
    // Log what data we have for the preview
    console.log('[preview-batch-pdf] Target player data:', {
      account: targetPlayer.account,
      hasActivity: !!targetPlayer.activity,
      hasPreCommitment: !!targetPlayer.preCommitment,
      hasCashless: !!targetPlayer.cashless,
      preCommitmentKeys: targetPlayer.preCommitment ? Object.keys(targetPlayer.preCommitment) : null,
      cashlessKeys: targetPlayer.cashless ? Object.keys(targetPlayer.cashless) : null,
    });

    // Convert logos to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Convert play-header to base64 for pre-commitment section
    const playHeaderPath = join(process.cwd(), 'public', 'no-play-header.png');
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
    console.error('[preview-batch-pdf] Error generating preview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to generate preview from batch',
        details: errorMessage 
      },
      { status: 500 }
    );
  }
}
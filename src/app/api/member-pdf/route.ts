import { NextRequest, NextResponse } from 'next/server';
import { getAccountFromBatch, getBatchById, getAccountFromPreviousBatches } from '@/lib/db';
import { generatePreviewHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { decryptJson } from '@/lib/encryption';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const accountNumber = searchParams.get('account');
    const batchId = searchParams.get('batch');
    const action = searchParams.get('action') || 'download'; // 'download' or 'preview'

    if (!accountNumber) {
      return NextResponse.json(
        { success: false, error: 'Account number is required' },
        { status: 400 }
      );
    }

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'Batch ID is required' },
        { status: 400 }
      );
    }

    // Get batch information
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get the specific account data (same approach as preview route)
    const normalizedAccount = normalizeAccount(accountNumber);
    let targetAccount = await getAccountFromBatch(batchId, normalizedAccount);

    if (!targetAccount) {
      // Try with original account number (not normalized) in case normalization changes it
      const targetAccountOriginal = await getAccountFromBatch(batchId, accountNumber);
      if (targetAccountOriginal) {
        targetAccount = targetAccountOriginal;
      }
    }

    if (!targetAccount) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this batch' },
        { status: 404 }
      );
    }

    // Get quarterlyData - same approach as preview route
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
    
    // If still not found, reconstruct from all cashless statements (same as preview)
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
            monthlyBreakdown: [],
          };
        }
      } catch (error) {
        console.error('Error reconstructing quarterlyData:', error);
      }
    }
    
    if (!quarterlyData) {
      console.error('[member-pdf] No quarterly data found for batch:', batchId);
      // Create a minimal quarterlyData structure from batch info
      // This allows PDF generation to work even if quarterlyData wasn't stored properly
      quarterlyData = {
        quarter: batch.quarter || 0,
        year: batch.year || new Date().getFullYear(),
        players: [],
        monthlyBreakdown: [],
      };
      
      console.warn('[member-pdf] Using minimal quarterlyData structure');
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
    // This ensures statementPeriod is set even if quarterlyData was minimal
    if (batch.start_date && batch.end_date && quarterlyData) {
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
    
    // Ensure quarterlyData has quarter and year from batch if still missing
    if (quarterlyData && (quarterlyData.quarter === undefined || quarterlyData.year === undefined)) {
      quarterlyData = {
        ...quarterlyData,
        quarter: batch.quarter || 0,
        year: batch.year || new Date().getFullYear(),
      };
    }

    // Extract the target player data from current batch
    let accountData = targetAccount.account_data;

    // If precommitment or cashless is missing, try to get from previous batches
    // This allows us to show the latest available data for each statement type
    if (!accountData.preCommitment || !accountData.cashless) {
      const previousBatches = await getAccountFromPreviousBatches(normalizedAccount, batchId);
      
      // If not found with normalized account, try with original account number
      const previousBatchesOriginal = previousBatches.length === 0 
        ? await getAccountFromPreviousBatches(accountNumber, batchId)
        : previousBatches;

      // Merge data from previous batches - get the latest available precommitment and cashless
      for (const prevAccount of previousBatchesOriginal) {
        // Get precommitment from previous batch if missing in current batch
        if (!accountData.preCommitment && prevAccount.account_data.preCommitment) {
          accountData = {
            ...accountData,
            preCommitment: prevAccount.account_data.preCommitment,
          };
          console.log(`[member-pdf] Merged precommitment from batch ${prevAccount.batch_id} for account ${normalizedAccount}`);
        }

        // Get cashless from previous batch if missing in current batch
        if (!accountData.cashless && prevAccount.account_data.cashless) {
          accountData = {
            ...accountData,
            cashless: prevAccount.account_data.cashless,
          };
          console.log(`[member-pdf] Merged cashless from batch ${prevAccount.batch_id} for account ${normalizedAccount}`);
        }

        // If we have both, we can break early
        if (accountData.preCommitment && accountData.cashless) {
          break;
        }
      }
    }

    // If quarterlyData is still missing monthly breakdown or we merged cashless from previous batch,
    // try to get quarterlyData from previous batches
    if (!quarterlyData || (quarterlyData.monthlyBreakdown && quarterlyData.monthlyBreakdown.length === 0)) {
      const previousBatches = await getAccountFromPreviousBatches(normalizedAccount, batchId);
      const previousBatchesOriginal = previousBatches.length === 0 
        ? await getAccountFromPreviousBatches(accountNumber, batchId)
        : previousBatches;

      // Look for quarterlyData with monthly breakdown in previous batches
      for (const prevAccount of previousBatchesOriginal) {
        if (prevAccount.account_data.quarterlyData) {
          const prevQuarterlyData = prevAccount.account_data.quarterlyData;
          // Use the quarterlyData from previous batch if:
          // 1. Current batch doesn't have quarterlyData, OR
          // 2. Previous batch has monthly breakdown and current doesn't
          if (!quarterlyData || 
              (prevQuarterlyData.monthlyBreakdown && 
               prevQuarterlyData.monthlyBreakdown.length > 0 && 
               (!quarterlyData.monthlyBreakdown || quarterlyData.monthlyBreakdown.length === 0))) {
            quarterlyData = prevQuarterlyData;
            console.log(`[member-pdf] Using quarterlyData from batch ${prevAccount.batch_id} for account ${normalizedAccount}`);
            break;
          }
        }
      }

      // If we still don't have quarterlyData but we have cashless in accountData,
      // reconstruct quarterlyData from it
      if (!quarterlyData && accountData.cashless) {
        quarterlyData = {
          quarter: batch.quarter,
          year: batch.year,
          players: [accountData.cashless],
          monthlyBreakdown: [],
        };
        console.log(`[member-pdf] Reconstructed quarterlyData from accountData.cashless for account ${normalizedAccount}`);
      }
    }

    // Convert logo to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Convert play-header to base64 for pre-commitment section (same as preview)
    const playHeaderPath = join(process.cwd(), 'public', 'no-play-header.png');
    const playHeaderBuffer = readFileSync(playHeaderPath);
    const playHeaderBase64 = playHeaderBuffer.toString('base64');
    const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;

    // Generate HTML using preview function (same as preview route)
    const html = generatePreviewHTML(accountData, quarterlyData, logoDataUrl, playHeaderDataUrl);

    // If action is preview, return HTML with print button
    if (action === 'preview') {
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
    }

    // Otherwise generate and return PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.setContent(html, { waitUntil: 'load', timeout: 90000 });
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for fonts

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    await browser.close();

    const sanitizedAccount = accountNumber.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
    const filename = `Statement_Q${batch.quarter}_${batch.year}_${sanitizedAccount}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating member PDF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getAccountFromBatch, getBatchById, getMemberByAccount, getAccountFromPreviousBatches } from '@/lib/db';
import { createEmailTrackingRecord, updateEmailTrackingStatus } from '@/lib/db/email';
import { generatePreviewHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { decryptJson } from '@/lib/encryption';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
import mysql from 'mysql2/promise';
import sgMail from '@sendgrid/mail';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account, batchId } = body;

    if (!account) {
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

    if (!process.env.SENDGRID_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'SendGrid API key not configured' },
        { status: 500 }
      );
    }

    // Get member from database to get email
    const member = await getMemberByAccount(account);
    if (!member) {
      return NextResponse.json(
        { success: false, error: 'Member not found' },
        { status: 404 }
      );
    }

    if (!member.email || member.email.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'No email address found for this member' },
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

    // Get the specific account data (same approach as member-pdf route)
    const normalizedAccount = normalizeAccount(account);
    let targetAccount = await getAccountFromBatch(batchId, normalizedAccount);

    if (!targetAccount) {
      // Try with original account number (not normalized) in case normalization changes it
      const targetAccountOriginal = await getAccountFromBatch(batchId, account);
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

    // Get quarterlyData - same approach as member-pdf route
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
            monthlyBreakdown: [],
          };
        }
      } catch (error) {
        console.error('Error reconstructing quarterlyData:', error);
      }
    }
    
    if (!quarterlyData) {
      console.error('[send-member-pdf] No quarterly data found for batch:', batchId);
      // Create a minimal quarterlyData structure from batch info
      // This allows PDF generation to work even if quarterlyData wasn't stored properly
      quarterlyData = {
        quarter: batch.quarter || 0,
        year: batch.year || new Date().getFullYear(),
        players: [],
        monthlyBreakdown: [],
      };
      
      console.warn('[send-member-pdf] Using minimal quarterlyData structure');
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
        ? await getAccountFromPreviousBatches(account, batchId)
        : previousBatches;

      // Merge data from previous batches - get the latest available precommitment and cashless
      for (const prevAccount of previousBatchesOriginal) {
        // Get precommitment from previous batch if missing in current batch
        if (!accountData.preCommitment && prevAccount.account_data.preCommitment) {
          accountData = {
            ...accountData,
            preCommitment: prevAccount.account_data.preCommitment,
          };
          console.log(`[send-member-pdf] Merged precommitment from batch ${prevAccount.batch_id} for account ${normalizedAccount}`);
        }

        // Get cashless from previous batch if missing in current batch
        if (!accountData.cashless && prevAccount.account_data.cashless) {
          accountData = {
            ...accountData,
            cashless: prevAccount.account_data.cashless,
          };
          console.log(`[send-member-pdf] Merged cashless from batch ${prevAccount.batch_id} for account ${normalizedAccount}`);
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
        ? await getAccountFromPreviousBatches(account, batchId)
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
            console.log(`[send-member-pdf] Using quarterlyData from batch ${prevAccount.batch_id} for account ${normalizedAccount}`);
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
        console.log(`[send-member-pdf] Reconstructed quarterlyData from accountData.cashless for account ${normalizedAccount}`);
      }
    }

    // Convert logo to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Convert play-header to base64 for pre-commitment section
    const playHeaderPath = join(process.cwd(), 'public', 'no-play-header.png');
    const playHeaderBuffer = readFileSync(playHeaderPath);
    const playHeaderBase64 = playHeaderBuffer.toString('base64');
    const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;

    // Generate HTML using preview function
    const html = generatePreviewHTML(accountData, quarterlyData, logoDataUrl, playHeaderDataUrl);

    // Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

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

      // Prepare email
      const playerName = [
        member.title,
        member.first_name,
        member.last_name
      ].filter(Boolean).join(' ') || 'Member';
      // Extract only the first word from firstName (in case it contains multiple names)
      const firstName = (member.first_name || 'Member').split(' ')[0];

      const quarterLabel = `Q${batch.quarter} ${batch.year}`;
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
      const pdfFileName = `Statement_Q${batch.quarter}_${batch.year}_${sanitizedAccount}.pdf`;
      const subject = `Your SkyCity Quarterly Statement - ${quarterLabel}`;

      // Create email tracking record before sending
      const trackingId = await createEmailTrackingRecord({
        recipient_email: member.email,
        recipient_account: normalizedAccount,
        recipient_name: playerName,
        email_type: 'quarterly',
        batch_id: batchId,
        subject: subject,
      });

      const msg = {
        to: member.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: subject,
        text: `Dear ${firstName},\n\nPlease find attached your quarterly statement for ${quarterLabel}.\n\nThank you for being a valued member of SkyCity.\n\nBest regards,\nSkyCity Team`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Dear ${firstName},</h2>
            <p>Please find attached your quarterly statement for <strong>${quarterLabel}</strong>.</p>
            <p>Thank you for being a valued member of SkyCity.</p>
            <p>Best regards,<br>SkyCity Team</p>
          </div>
        `,
        attachments: [
          {
            content: pdfBase64,
            filename: pdfFileName,
            type: 'application/pdf',
            disposition: 'attachment'
          }
        ],
        custom_args: {
          email_tracking_id: trackingId,
          sender_email: process.env.SENDGRID_FROM_EMAIL || 'statements@e.skycity.com.au'
        }
      };

      // Send email via SendGrid
      try {
        const [response] = await sgMail.send(msg);
        
        // Extract SendGrid message ID from response headers
        const messageId = response.headers?.['x-message-id']?.[0] || null;
        
        // Update tracking record with sent status
        await updateEmailTrackingStatus(trackingId, {
          status: 'sent',
          sendgrid_message_id: messageId,
          sent_at: new Date(),
        });
      } catch (sendError) {
        // Update tracking record with failed status
        const errorMessage = sendError instanceof Error ? sendError.message : 'Failed to send email';
        await updateEmailTrackingStatus(trackingId, {
          status: 'failed',
          error_message: errorMessage,
        });
        throw sendError;
      }

      return NextResponse.json({
        success: true,
        message: `PDF sent successfully to ${member.email}`,
        email: member.email
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Error sending member PDF:', error);
    
    // Handle SendGrid errors
    if (error instanceof Error && 'response' in error) {
      const sgError = error as any;
      if (sgError.response?.body) {
        return NextResponse.json(
          { success: false, error: `SendGrid error: ${JSON.stringify(sgError.response.body)}` },
          { status: 500 }
        );
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to send PDF';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}







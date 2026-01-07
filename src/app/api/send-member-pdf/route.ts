import { NextRequest, NextResponse } from 'next/server';
import { getAccountFromBatch, getBatchById, getMemberByAccount, getAccountFromPreviousBatches } from '@/lib/db';
import { createEmailTrackingRecord, updateEmailTrackingStatus } from '@/lib/db/email';
import { normalizeAccount } from '@/lib/pdf-shared';
import { decryptJson } from '@/lib/encryption';
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

// Increase timeout for email sending (PDF generation + email sending can take time)
export const maxDuration = 120; // 2 minutes

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

    // Fetch PDF from the member-pdf API endpoint (same as preview URL)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    const pdfUrl = `${baseUrl}/api/member-pdf?account=${encodeURIComponent(account)}&batch=${encodeURIComponent(batchId)}`;
    
    let pdfBuffer: Buffer;
    try {
      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch PDF: ${pdfResponse.statusText}`);
      }
      const arrayBuffer = await pdfResponse.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Error fetching PDF from URL:', error);
      throw new Error(`Failed to fetch PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

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

      // Logo URL (same as play/no-play)
      const logoUrl = 'https://i.imgur.com/MilwIKt.png';

      const msg = {
        to: member.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: subject,
        text: `Account: ${normalizedAccount}\n\nDear ${firstName},\n\nYour Quarterly Statement for ${quarterLabel} is now available for viewing and is attached to this email.\n\nIf you have questions about your activity statement, please speak with the staff at the Rewards or the Host desk or, alternatively call (08) 8218 2811. If your gambling is a concern or you are concerned about someone's gambling, we encourage you to get in touch with our specially trained staff by calling (08) 8218 414 and ask for our Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.\n\nKind Regards,\nSkyCity Adelaide`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0; padding: 20px;">
            <div style="text-align: left; margin-bottom: 20px;">
              <img src="${logoUrl}" alt="SkyCity Adelaide" style="max-width: 200px; height: auto;" />
            </div>
            <div style="text-align: right; margin-bottom: 20px;">
              <p style="margin: 0; color: #1a1a1a; font-size: 14px;">Account: ${normalizedAccount}</p>
            </div>
            <div style="color: #1a1a1a; line-height: 1.6;">
              <p style="margin: 0 0 20px 0;">Dear ${firstName},</p>
              <p style="margin: 0 0 20px 0;">Your Quarterly Statement for ${quarterLabel} is now available for viewing and is attached to this email.</p>
              <p style="margin: 0 0 20px 0;">If you have questions about your activity statement, please speak with the staff at the Rewards or the Host desk or, alternatively call (08) 8218 2811. If your gambling is a concern or you are concerned about someone's gambling, we encourage you to get in touch with our specially trained staff by calling (08) 8218 414 and ask for our Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.</p>
              <p style="margin: 0;">Kind Regards,<br>SkyCity Adelaide</p>
            </div>
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
        // SendGrid headers can be in different formats - try multiple approaches
        let messageId: string | null = null;
        
        if (response?.headers) {
          // Try different header formats
          const headers = response.headers;
          
          // Try as object with lowercase key
          if (headers['x-message-id']) {
            messageId = Array.isArray(headers['x-message-id']) 
              ? headers['x-message-id'][0] 
              : headers['x-message-id'];
          }
          // Try as object with different case
          else if (headers['X-Message-Id']) {
            messageId = Array.isArray(headers['X-Message-Id']) 
              ? headers['X-Message-Id'][0] 
              : headers['X-Message-Id'];
          }
          // Try as Map
          else if (headers instanceof Map) {
            messageId = headers.get('x-message-id') || headers.get('X-Message-Id') || null;
          }
        }
        
        // Log if message ID extraction failed for debugging
        if (!messageId) {
          console.warn('[Send Email] Could not extract SendGrid message ID from response:', {
            hasResponse: !!response,
            hasHeaders: !!response?.headers,
            headersKeys: response?.headers ? Object.keys(response.headers) : [],
            responseType: typeof response
          });
        }
        
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







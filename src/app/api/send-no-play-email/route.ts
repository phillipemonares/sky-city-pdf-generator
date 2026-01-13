import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { createEmailTrackingRecord, updateEmailTrackingStatus } from '@/lib/db/email';
import { generatePreCommitmentPDFHTML } from '@/lib/pc-no-play-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { encryptDeterministic, decrypt, decryptJson } from '@/lib/encryption';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
import sgMail from '@sendgrid/mail';
import mysql from 'mysql2/promise';
import { PreCommitmentPlayer } from '@/types/player-data';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Increase timeout for email sending (PDF generation + email sending can take time)
export const maxDuration = 120; // 2 minutes

/**
 * Get no-play player data by account number and batch ID
 */
async function getNoPlayPlayerByAccountAndBatch(
  accountNumber: string,
  batchId: string
): Promise<{ player: any; batch: any } | null> {
  try {
    const normalizedAccount = normalizeAccount(accountNumber);
    const encryptedAccount = encryptDeterministic(normalizedAccount);

    // Query to find no-play player matching account and batch ID
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT 
        npp.id,
        npp.batch_id,
        npp.account_number,
        npp.player_data,
        npp.statement_period,
        npp.statement_date,
        npp.no_play_status,
        npb.generation_date,
        npb.total_players
       FROM no_play_players npp
       INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
       WHERE npp.account_number = ? 
         AND npp.batch_id = ?
         AND npp.no_play_status = 'No Play'
       LIMIT 1`,
      [encryptedAccount, batchId]
    );

    if (rows.length === 0) {
      // Try with unencrypted account (legacy data)
      const [unencryptedRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT 
          npp.id,
          npp.batch_id,
          npp.account_number,
          npp.player_data,
          npp.statement_period,
          npp.statement_date,
          npp.no_play_status,
          npb.generation_date,
          npb.total_players
         FROM no_play_players npp
         INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
         WHERE npp.account_number = ? 
           AND npp.batch_id = ?
           AND npp.no_play_status = 'No Play'
         LIMIT 1`,
        [normalizedAccount, batchId]
      );

      if (unencryptedRows.length === 0) {
        return null;
      }

      const row = unencryptedRows[0];
      // Decrypt player_data
      let playerData: PreCommitmentPlayer;
      try {
        playerData = decryptJson<PreCommitmentPlayer>(row.player_data);
      } catch (error) {
        playerData = JSON.parse(row.player_data) as PreCommitmentPlayer;
      }

      return {
        player: {
          id: row.id,
          batch_id: row.batch_id,
          account_number: normalizedAccount,
          player_data: playerData,
          statement_period: row.statement_period,
          statement_date: row.statement_date,
          no_play_status: row.no_play_status,
        },
        batch: {
          id: row.batch_id,
          generation_date: new Date(row.generation_date),
          total_players: row.total_players,
        },
      };
    }

    const row = rows[0];
    // Decrypt account_number and player_data
    const decryptedAccount = decrypt(row.account_number);
    
    // Decrypt player_data
    let playerData: PreCommitmentPlayer;
    try {
      playerData = decryptJson<PreCommitmentPlayer>(row.player_data);
    } catch (error) {
      playerData = JSON.parse(row.player_data) as PreCommitmentPlayer;
    }

    return {
      player: {
        id: row.id,
        batch_id: row.batch_id,
        account_number: decryptedAccount,
        player_data: playerData,
        statement_period: row.statement_period,
        statement_date: row.statement_date,
        no_play_status: row.no_play_status,
      },
      batch: {
        id: row.batch_id,
        generation_date: new Date(row.generation_date),
        total_players: row.total_players,
      },
    };
  } catch (error) {
    console.error('Error getting no-play player by account and batch:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account, batchId, email, token } = body;

    // Check authentication token
    const authToken = request.headers.get('authorization')?.replace('Bearer ', '') || 
                     request.headers.get('x-api-token') || 
                     token;
    
    const expectedToken = process.env.QUARTERLY_PDF_API_TOKEN;
    
    if (!expectedToken) {
      return NextResponse.json(
        { success: false, error: 'API token not configured' },
        { status: 500 }
      );
    }
    
    if (!authToken || authToken !== expectedToken) {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication token' },
        { status: 401 }
      );
    }

    // Validate required parameters
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

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email address is required' },
        { status: 400 }
      );
    }

    if (!process.env.SENDGRID_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'SendGrid API key not configured' },
        { status: 500 }
      );
    }

    // Normalize account number
    const normalizedAccount = normalizeAccount(account);

    // Get no-play player data by account and batch ID
    const playerData = await getNoPlayPlayerByAccountAndBatch(normalizedAccount, batchId);

    if (!playerData) {
      return NextResponse.json(
        { success: false, error: 'No-play player data not found for this account and batch' },
        { status: 404 }
      );
    }

    const targetPlayer = playerData.player;
    const batch = playerData.batch;

    // Use provided email or fallback to email from player data
    const recipientEmail = email || targetPlayer.player_data?.playerInfo?.email || '';
    
    if (!recipientEmail || recipientEmail.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'No email address provided or found in player data' },
        { status: 400 }
      );
    }

    // Convert no-play header to base64
    const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
    const headerBuffer = readFileSync(headerPath);
    const headerBase64 = headerBuffer.toString('base64');
    const headerDataUrl = `data:image/png;base64,${headerBase64}`;

    // Generate HTML using the no-play template
    const html = generatePreCommitmentPDFHTML(targetPlayer.player_data, headerDataUrl, null);

    // Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      // Set longer timeout for PDF generation (2 minutes)
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(120000);
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120000 });

      // Wait for fonts to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        },
      });

      await browser.close();

      // Prepare email - use playerData.playerInfo as source of truth
      const playerInfo = targetPlayer.player_data?.playerInfo || {};
      const playerName = [
        playerInfo.salutation,
        playerInfo.firstName,
        playerInfo.lastName
      ].filter(Boolean).join(' ') || 'Member';
      // Extract only the first word from firstName (in case it contains multiple names)
      const firstName = (playerInfo.firstName || 'Member').split(' ')[0];

      const statementPeriod = targetPlayer.statement_period || 'Current Period';
      
      // Parse statement period to extract dates in format "1 March 2025 – 30 June 2025"
      let formattedPeriod = statementPeriod;
      let endDateStr = '';
      
      if (statementPeriod.includes(' - ')) {
        const [startDatePart, endDatePart] = statementPeriod.split(' - ');
        formattedPeriod = `${startDatePart.trim()} – ${endDatePart.trim()}`;
        endDateStr = endDatePart.trim();
      } else if (statementPeriod.includes(' and ')) {
        // Convert "and" to en dash format
        const [startDatePart, endDatePart] = statementPeriod.split(' and ');
        formattedPeriod = `${startDatePart.trim()} – ${endDatePart.trim()}`;
        endDateStr = endDatePart.trim();
      } else if (statementPeriod.includes(' – ')) {
        // Already in correct format
        formattedPeriod = statementPeriod;
        const parts = statementPeriod.split(' – ');
        if (parts.length > 1) {
          endDateStr = parts[1].trim();
        }
      }

      // Get quarter and year from the end date in statementPeriod
      // Parse the end date to extract year and determine quarter
      let quarter = 0;
      let year = new Date().getFullYear();
      
      // Try to parse the end date from statementPeriod first
      if (endDateStr) {
        try {
          // Parse date string like "30 June 2025" or "30 June, 2025"
          const dateStr = endDateStr.replace(/,/g, '').trim();
          
          // Try parsing with Date constructor first
          let parsedEndDate = new Date(dateStr);
          
          // If that fails, try manual parsing for format "DD Month YYYY"
          if (isNaN(parsedEndDate.getTime())) {
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                              'july', 'august', 'september', 'october', 'november', 'december'];
            const parts = dateStr.split(/\s+/);
            if (parts.length >= 3) {
              const day = parseInt(parts[0], 10);
              const monthName = parts[1].toLowerCase();
              const yearStr = parseInt(parts[2], 10);
              const monthIndex = monthNames.findIndex(m => m.startsWith(monthName));
              
              if (monthIndex >= 0 && !isNaN(yearStr)) {
                parsedEndDate = new Date(yearStr, monthIndex, day);
              }
            }
          }
          
          if (!isNaN(parsedEndDate.getTime())) {
            year = parsedEndDate.getFullYear();
            const month = parsedEndDate.getMonth() + 1; // getMonth() returns 0-11
            // Determine quarter from month: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
            if (month >= 1 && month <= 3) quarter = 1;
            else if (month >= 4 && month <= 6) quarter = 2;
            else if (month >= 7 && month <= 9) quarter = 3;
            else if (month >= 10 && month <= 12) quarter = 4;
          }
        } catch (error) {
          console.warn('Could not parse end date from statementPeriod for quarter/year:', error);
        }
      }
      
      // Fallback to batch.generation_date if we couldn't parse from statementPeriod
      if (quarter === 0 && batch.generation_date) {
        try {
          const statementDate = new Date(batch.generation_date);
          if (!isNaN(statementDate.getTime())) {
            year = statementDate.getFullYear();
            const month = statementDate.getMonth() + 1; // getMonth() returns 0-11
            // Determine quarter from month: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
            if (month >= 1 && month <= 3) quarter = 1;
            else if (month >= 4 && month <= 6) quarter = 2;
            else if (month >= 7 && month <= 9) quarter = 3;
            else if (month >= 10 && month <= 12) quarter = 4;
          }
        } catch (error) {
          console.warn('Could not parse generation_date for quarter/year:', error);
        }
      }
      
      // Final fallback: use current date if still no quarter
      if (quarter === 0) {
        const now = new Date();
        year = now.getFullYear();
        const month = now.getMonth() + 1;
        if (month >= 1 && month <= 3) quarter = 1;
        else if (month >= 4 && month <= 6) quarter = 2;
        else if (month >= 7 && month <= 9) quarter = 3;
        else if (month >= 10 && month <= 12) quarter = 4;
      }
      
      const quarterLabel = `Q${quarter} ${year}`;

      // Logo URL
      const logoUrl = 'https://i.imgur.com/MilwIKt.png';

      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
      const pdfFileName = `NoPlay_PreCommitment_${sanitizedAccount}_${formattedPeriod.replace(/\s+/g, '_')}.pdf`;
      const subject = 'Your MyPlay Statement';

      // Create email tracking record before sending
      const trackingId = await createEmailTrackingRecord({
        recipient_email: recipientEmail,
        recipient_account: normalizedAccount,
        recipient_name: playerName,
        email_type: 'no-play',
        batch_id: batch.id,
        subject: subject,
      });

      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: subject,
        text: `Dear ${firstName},\n\nYour MyPlay Statement for ${quarterLabel} is now available for viewing and is attached to this email.\n\nIf you have questions about your MyPlay statement, please speak with the staff at the Rewards or the Host desk or, alternatively call (08) 8218 2811. If your gambling is a concern or you are concerned about someone's gambling, we encourage you to get in touch with our specially trained staff by calling (08) 8218 4141 and ask for our Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.\n\nKind Regards,\nSkyCity Adelaide`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0; padding: 20px;">
            <div style="text-align: left; margin-bottom: 20px;">
              <img src="${logoUrl}" alt="SkyCity Adelaide" style="max-width: 200px; height: auto;" />
            </div>
            <div style="color: #1a1a1a; line-height: 1.6;">
              <p style="margin: 0 0 20px 0;">Dear ${firstName},</p>
              <p style="margin: 0 0 20px 0;">Your MyPlay Statement for ${quarterLabel} is now available for viewing and is attached to this email.</p>
              <p style="margin: 0 0 20px 0;">If you have questions about your MyPlay statement, please speak with the staff at the Rewards or the Host desk or, alternatively call (08) 8218 2811. If your gambling is a concern or you are concerned about someone's gambling, we encourage you to get in touch with our specially trained staff by calling (08) 8218 4141 and ask for our Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.</p>
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
        let messageId: string | null = null;
        
        if (response?.headers) {
          const headers = response.headers;
          
          if (headers['x-message-id']) {
            messageId = Array.isArray(headers['x-message-id']) 
              ? headers['x-message-id'][0] 
              : headers['x-message-id'];
          }
          else if (headers['X-Message-Id']) {
            messageId = Array.isArray(headers['X-Message-Id']) 
              ? headers['X-Message-Id'][0] 
              : headers['X-Message-Id'];
          }
          else if (headers instanceof Map) {
            messageId = headers.get('x-message-id') || headers.get('X-Message-Id') || null;
          }
        }
        
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
        message: `PDF sent successfully to ${recipientEmail}`,
        email: recipientEmail
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Error sending no-play email:', error);
    
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
    
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 }
    );
  }
}


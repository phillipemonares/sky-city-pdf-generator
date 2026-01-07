import { NextRequest, NextResponse } from 'next/server';
import { getNoPlayBatchById, getNoPlayPlayersByBatch } from '@/lib/db';
import { createEmailTrackingRecord, updateEmailTrackingStatus } from '@/lib/db/email';
import { generatePreCommitmentPDFHTML } from '@/lib/pc-no-play-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
import sgMail from '@sendgrid/mail';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

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

    // Normalize account number
    const normalizedAccount = normalizeAccount(account);

    // Get batch information
    const batch = await getNoPlayBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get all players from the batch
    const players = await getNoPlayPlayersByBatch(batchId);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca5f2dea-fea2-4816-8058-9303394d589c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-no-play-member-pdf/route.ts:65',message:'Players from batch',data:{batchId,playersCount:players.length,accountNumbers:players.slice(0,5).map(p=>normalizeAccount(p.account_number))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion

    // Find the specific account
    const targetPlayer = players.find(
      p => normalizeAccount(p.account_number) === normalizedAccount
    );
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca5f2dea-fea2-4816-8058-9303394d589c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-no-play-member-pdf/route.ts:70',message:'Target player search result',data:{account:normalizedAccount,targetPlayerFound:!!targetPlayer,targetPlayerAccount:targetPlayer?.account_number},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion

    if (!targetPlayer) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this batch' },
        { status: 404 }
      );
    }

    // Extract email from player_data (this is the source of truth for no-play statements)
    // player_data is already parsed as PreCommitmentPlayer by getNoPlayPlayersByBatch
    const playerData = targetPlayer.player_data;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca5f2dea-fea2-4816-8058-9303394d589c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-no-play-member-pdf/route.ts:81',message:'PlayerData available info',data:{hasPlayerInfo:!!playerData?.playerInfo,hasFirstName:!!playerData?.playerInfo?.firstName,hasLastName:!!playerData?.playerInfo?.lastName,hasEmail:!!playerData?.playerInfo?.email,hasSalutation:!!playerData?.playerInfo?.salutation,firstName:playerData?.playerInfo?.firstName,lastName:playerData?.playerInfo?.lastName,email:playerData?.playerInfo?.email},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4,H5'})}).catch(()=>{});
    // #endregion
    
    // Get email from player_data (this is where the updated email should be)
    const recipientEmail = playerData?.playerInfo?.email || '';
    
    if (!recipientEmail || recipientEmail.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'No email address found in player data for this member' },
        { status: 400 }
      );
    }

    // Convert no-play header to base64
    const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
    const headerBuffer = readFileSync(headerPath);
    const headerBase64 = headerBuffer.toString('base64');
    const headerDataUrl = `data:image/png;base64,${headerBase64}`;

    // Generate HTML using the no-play template
    // Use the parsed playerData (which may have been decrypted)
    // No member data needed - playerData.playerInfo has all the info we need
    const html = generatePreCommitmentPDFHTML(playerData, headerDataUrl, null);

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
      const playerInfo = playerData?.playerInfo || {};
      const playerName = [
        playerInfo.salutation,
        playerInfo.firstName,
        playerInfo.lastName
      ].filter(Boolean).join(' ') || 'Member';
      // Extract only the first word from firstName (in case it contains multiple names)
      const firstName = (playerInfo.firstName || 'Member').split(' ')[0];

      const statementPeriod = playerData.statementPeriod || 'Current Period';
      
      // Parse statement period to extract dates in format "1 March 2025 – 30 June 2025"
      let formattedPeriod = statementPeriod;
      let endDateStr = '';
      
      if (statementPeriod.includes(' - ')) {
        const [startDate, endDate] = statementPeriod.split(' - ');
        formattedPeriod = `${startDate.trim()} – ${endDate.trim()}`;
        endDateStr = endDate.trim();
      } else if (statementPeriod.includes(' and ')) {
        // Convert "and" to en dash format
        const [startDate, endDate] = statementPeriod.split(' and ');
        formattedPeriod = `${startDate.trim()} – ${endDate.trim()}`;
        endDateStr = endDate.trim();
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
          let endDate = new Date(dateStr);
          
          // If that fails, try manual parsing for format "DD Month YYYY"
          if (isNaN(endDate.getTime())) {
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                              'july', 'august', 'september', 'october', 'november', 'december'];
            const parts = dateStr.split(/\s+/);
            if (parts.length >= 3) {
              const day = parseInt(parts[0], 10);
              const monthName = parts[1].toLowerCase();
              const yearStr = parseInt(parts[2], 10);
              const monthIndex = monthNames.findIndex(m => m.startsWith(monthName));
              
              if (monthIndex >= 0 && !isNaN(yearStr)) {
                endDate = new Date(yearStr, monthIndex, day);
              }
            }
          }
          
          if (!isNaN(endDate.getTime())) {
            year = endDate.getFullYear();
            const month = endDate.getMonth() + 1; // getMonth() returns 0-11
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
      
      // Fallback to batch.statement_date if we couldn't parse from statementPeriod
      if (quarter === 0 && batch.statement_date) {
        try {
          const statementDate = new Date(batch.statement_date);
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
          console.warn('Could not parse statement_date for quarter/year:', error);
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
      const pdfFileName = `NoPlay_PreCommitment_${sanitizedAccount}_${statementPeriod.replace(/\s+/g, '_')}.pdf`;
      const subject = 'Your MyPlay Statement';

      // Create email tracking record before sending
      const trackingId = await createEmailTrackingRecord({
        recipient_email: recipientEmail,
        recipient_account: normalizedAccount,
        recipient_name: playerName,
        email_type: 'no-play',
        batch_id: batchId,
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
        message: `PDF sent successfully to ${recipientEmail}`,
        email: recipientEmail
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Error sending no-play member PDF:', error);
    
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
      { success: false, error: error instanceof Error ? error.message : 'Failed to send PDF' },
      { status: 500 }
    );
  }
}










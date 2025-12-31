import { NextRequest, NextResponse } from 'next/server';
import { getNoPlayBatchById, getNoPlayPlayersByBatch, getMemberByAccount } from '@/lib/db';
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
    const normalizedAccount = normalizeAccount(account);
    const member = await getMemberByAccount(normalizedAccount);
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
    const batch = await getNoPlayBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get all players from the batch
    const players = await getNoPlayPlayersByBatch(batchId);

    // Find the specific account
    const targetPlayer = players.find(
      p => normalizeAccount(p.account_number) === normalizedAccount
    );

    if (!targetPlayer) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this batch' },
        { status: 404 }
      );
    }

    // Convert no-play header to base64
    const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
    const headerBuffer = readFileSync(headerPath);
    const headerBase64 = headerBuffer.toString('base64');
    const headerDataUrl = `data:image/png;base64,${headerBase64}`;

    // Generate HTML using the no-play template
    const html = generatePreCommitmentPDFHTML(targetPlayer.player_data, headerDataUrl, member);

    // Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

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

      // Prepare email
      const playerName = [
        member.title,
        member.first_name,
        member.last_name
      ].filter(Boolean).join(' ') || 'Member';
      const firstName = member.first_name || 'Member';

      const statementPeriod = targetPlayer.player_data.statementPeriod || 'Current Period';
      
      // Parse statement period to extract dates in format "1 March 2025 and 30 June 2025"
      let formattedPeriod = statementPeriod;
      if (statementPeriod.includes(' - ')) {
        const [startDate, endDate] = statementPeriod.split(' - ');
        formattedPeriod = `${startDate.trim()} and ${endDate.trim()}`;
      } else if (statementPeriod.includes(' and ')) {
        // Already in correct format
        formattedPeriod = statementPeriod;
      }

      // Logo URL
      const logoUrl = 'https://i.imgur.com/MilwIKt.png';

      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
      const pdfFileName = `NoPlay_PreCommitment_${sanitizedAccount}_${statementPeriod.replace(/\s+/g, '_')}.pdf`;
      const subject = 'Your MyPlay Statement';

      // Create email tracking record before sending
      const trackingId = await createEmailTrackingRecord({
        recipient_email: member.email,
        recipient_account: normalizedAccount,
        recipient_name: playerName,
        email_type: 'no-play',
        batch_id: batchId,
        subject: subject,
      });

      const msg = {
        to: member.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: subject,
        text: `Account: ${normalizedAccount}\n\nDear ${firstName},\n\nYour Pre-Commitment Statement for the period ${formattedPeriod} is now available for viewing and is attached to this email.\n\nWe would like to inform you that the attached statement reflects data for a 4-month period, rather than the usual 6 months. This adjustment is due to a change in our reporting structure. Moving forward, we will be issuing your MyPlay Statement quarterly with your activity statement, creating a more streamlined overview of your account.\n\nThe period covered in this statement represents the time between the end of your previous statement and the start of the new statement format.\n\nIf you or someone you know needs help, please get in touch with our specially trained staff by calling (08) 8212 2811. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.\n\nPlease feel free to contact SkyCity Rewards or a VIP Host if you have any questions regarding statements.\n\nKind Regards,\nSkyCity Adelaide`,
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
              <p style="margin: 0 0 20px 0;">Your Pre-Commitment Statement for the period ${formattedPeriod} is now available for viewing and is attached to this email.</p>
              <p style="margin: 0 0 20px 0;">We would like to inform you that the attached statement reflects data for a 4-month period, rather than the usual 6 months. This adjustment is due to a change in our reporting structure. Moving forward, we will be issuing your MyPlay Statement quarterly with your activity statement, creating a more streamlined overview of your account.</p>
              <p style="margin: 0 0 20px 0;">The period covered in this statement represents the time between the end of your previous statement and the start of the new statement format.</p>
              <p style="margin: 0 0 20px 0;">If you or someone you know needs help, please get in touch with our specially trained staff by calling (08) 8212 2811. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.</p>
              <p style="margin: 0 0 20px 0;">Please feel free to contact SkyCity Rewards or a VIP Host if you have any questions regarding statements.</p>
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










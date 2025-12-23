import { NextRequest, NextResponse } from 'next/server';
import { getNoPlayBatchById, getNoPlayPlayersByBatch, getMemberByAccount } from '@/lib/db';
import { createEmailTrackingRecord, updateEmailTrackingStatus } from '@/lib/db/email';
import { generatePlayPreCommitmentPDFHTML } from '@/lib/pc-play-pdf-template';
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

    // Find the specific account (must be Play status)
    const targetPlayer = players.find(
      p => normalizeAccount(p.account_number) === normalizedAccount && p.no_play_status === 'Play'
    );

    if (!targetPlayer) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this batch or is not a Play member' },
        { status: 404 }
      );
    }

    // Convert no-play header to base64
    const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
    const headerBuffer = readFileSync(headerPath);
    const headerBase64 = headerBuffer.toString('base64');
    const headerDataUrl = `data:image/png;base64,${headerBase64}`;

    // Generate HTML using the play template
    const html = generatePlayPreCommitmentPDFHTML(targetPlayer.player_data, headerDataUrl, member);

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

      const statementPeriod = targetPlayer.player_data.statementPeriod || 'Current Period';
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
      const pdfFileName = `Play_PreCommitment_${sanitizedAccount}_${statementPeriod.replace(/\s+/g, '_')}.pdf`;
      const subject = `Your SkyCity Play Pre-Commitment Statement - ${statementPeriod}`;

      // Create email tracking record before sending
      const trackingId = await createEmailTrackingRecord({
        recipient_email: member.email,
        recipient_account: normalizedAccount,
        recipient_name: playerName,
        email_type: 'play',
        batch_id: batchId,
        subject: subject,
      });

      const msg = {
        to: member.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: subject,
        text: `Dear ${playerName},\n\nPlease find attached your Play Pre-Commitment statement for ${statementPeriod}.\n\nThank you for being a valued member of SkyCity.\n\nBest regards,\nSkyCity Team`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Dear ${playerName},</h2>
            <p>Please find attached your Play Pre-Commitment statement for <strong>${statementPeriod}</strong>.</p>
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
          email_tracking_id: trackingId
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
    console.error('Error sending play member PDF:', error);
    
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





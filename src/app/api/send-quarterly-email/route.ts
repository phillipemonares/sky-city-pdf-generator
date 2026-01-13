import { NextRequest, NextResponse } from 'next/server';
import { getMemberByAccount, pool } from '@/lib/db';
import { createEmailTrackingRecord, updateEmailTrackingStatus } from '@/lib/db/email';
import { normalizeAccount } from '@/lib/pdf-shared';
import { encryptDeterministic } from '@/lib/encryption';
import sgMail from '@sendgrid/mail';
import mysql from 'mysql2/promise';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Increase timeout for email sending (PDF generation + email sending can take time)
export const maxDuration = 120; // 2 minutes

/**
 * Get batch ID by account number and date range
 */
async function getBatchByAccountAndDateRange(
  accountNumber: string,
  startDate: Date,
  endDate: Date
): Promise<string | null> {
  try {
    const normalizedAccount = normalizeAccount(accountNumber);
    const encryptedAccount = encryptDeterministic(normalizedAccount);

    // Format dates for comparison
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Query to find batch matching account and date range
    // We'll look for batches where the start_date and end_date overlap with the requested range
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT DISTINCT gb.id, gb.generation_date
       FROM generation_batches gb
       INNER JOIN quarterly_user_statements qus ON gb.id = qus.batch_id
       WHERE qus.account_number = ? 
         AND gb.start_date <= ?
         AND gb.end_date >= ?
       ORDER BY gb.generation_date DESC
       LIMIT 1`,
      [encryptedAccount, endDateStr, startDateStr]
    );

    if (rows.length === 0) {
      // Try with unencrypted account (legacy data)
      const [unencryptedRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT DISTINCT gb.id, gb.generation_date
         FROM generation_batches gb
         INNER JOIN quarterly_user_statements qus ON gb.id = qus.batch_id
         WHERE qus.account_number = ? 
           AND gb.start_date <= ?
           AND gb.end_date >= ?
         ORDER BY gb.generation_date DESC
         LIMIT 1`,
        [normalizedAccount, endDateStr, startDateStr]
      );

      if (unencryptedRows.length === 0) {
        return null;
      }

      return unencryptedRows[0].id;
    }

    return rows[0].id;
  } catch (error) {
    console.error('Error getting batch by account and date range:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account, startDate, endDate, email, token } = body;

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

    if (!startDate) {
      return NextResponse.json(
        { success: false, error: 'Start date is required' },
        { status: 400 }
      );
    }

    if (!endDate) {
      return NextResponse.json(
        { success: false, error: 'End date is required' },
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

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use YYYY-MM-DD or ISO format' },
        { status: 400 }
      );
    }

    // Normalize account number
    const normalizedAccount = normalizeAccount(account);

    // Get member data to verify account exists
    const member = await getMemberByAccount(normalizedAccount);
    if (!member) {
      return NextResponse.json(
        { success: false, error: 'Member not found' },
        { status: 404 }
      );
    }

    // Get batch ID by account and date range
    const batchId = await getBatchByAccountAndDateRange(normalizedAccount, start, end);

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'No quarterly statement found for this account and date range' },
        { status: 404 }
      );
    }

    // Get batch information to get quarter and year
    const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, quarter, year, generation_date, start_date, end_date 
       FROM generation_batches 
       WHERE id = ?`,
      [batchId]
    );

    if (batchRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    const batch = batchRows[0];

    // Fetch PDF from the member-pdf API endpoint
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

    // Use provided email
    const recipientEmail = email;

    // Create email tracking record before sending
    const trackingId = await createEmailTrackingRecord({
      recipient_email: recipientEmail,
      recipient_account: normalizedAccount,
      recipient_name: playerName,
      email_type: 'quarterly',
      batch_id: batchId,
      subject: subject,
    });

    // Logo URL
    const logoUrl = 'https://i.imgur.com/MilwIKt.png';

    const msg = {
      to: recipientEmail,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
      subject: subject,
      text: `Account: ${normalizedAccount}\n\nDear ${firstName},\n\nYour Quarterly Statement for ${quarterLabel} is now available for viewing and is attached to this email.\n\nIf you have questions about your activity statement, please speak with the staff at the Rewards or the Host desk or, alternatively call (08) 8218 2811. If your gambling is a concern or you are concerned about someone's gambling, we encourage you to get in touch with our specially trained staff by calling (08) 8218 4141 and ask for our Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.\n\nKind Regards,\nSkyCity Adelaide`,
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
            <p style="margin: 0 0 20px 0;">If you have questions about your activity statement, please speak with the staff at the Rewards or the Host desk or, alternatively call (08) 8218 2811. If your gambling is a concern or you are concerned about someone's gambling, we encourage you to get in touch with our specially trained staff by calling (08) 8218 4141 and ask for our Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.</p>
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
      email: recipientEmail,
      batchId: batchId,
      quarter: batch.quarter,
      year: batch.year
    });

  } catch (error) {
    console.error('Error sending quarterly email:', error);
    
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
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to send email';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

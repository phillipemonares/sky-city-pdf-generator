import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import sgMail from '@sendgrid/mail';
import { buildAnnotatedPlayers, generateAnnotatedHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { AnnotatedPDFGenerationRequest } from '@/types/player-data';
import { readFileSync } from 'fs';
import { join } from 'path';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export async function POST(request: NextRequest) {
  try {
    const body: AnnotatedPDFGenerationRequest = await request.json();
    const { activityRows, preCommitmentPlayers, quarterlyData, account } = body;

    if (!activityRows || activityRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No activity statement data provided' },
        { status: 400 }
      );
    }

    if (!preCommitmentPlayers || preCommitmentPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No pre-commitment data provided' },
        { status: 400 }
      );
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No cashless monthly data provided' },
        { status: 400 }
      );
    }

    if (!process.env.SENDGRID_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'SendGrid API key not configured' },
        { status: 500 }
      );
    }

    const annotatedPlayers = buildAnnotatedPlayers(activityRows, preCommitmentPlayers, quarterlyData);

    if (annotatedPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No matching accounts found across uploads' },
        { status: 400 }
      );
    }

    const requestedAccount = normalizeAccount(account);
    const targetPlayer = requestedAccount
      ? annotatedPlayers.find(player => normalizeAccount(player.account) === requestedAccount)
      : annotatedPlayers[0];

    if (!targetPlayer) {
      return NextResponse.json(
        { success: false, error: 'Requested account was not found in the matched players' },
        { status: 404 }
      );
    }

    if (!targetPlayer.activity?.email) {
      return NextResponse.json(
        { success: false, error: 'No email address found for this account' },
        { status: 400 }
      );
    }

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      
      // Set timeout for page operations
      page.setDefaultTimeout(10000);
      
      // Convert logo to base64
      const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
      const logoBuffer = readFileSync(logoPath);
      const logoBase64 = logoBuffer.toString('base64');
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      // Generate PDF
      const html = generateAnnotatedHTML(targetPlayer, quarterlyData, logoDataUrl);
      
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
        }
      });
      
      await browser.close();

      // Prepare email
      const playerName = [
        targetPlayer.activity.title,
        targetPlayer.activity.firstName,
        targetPlayer.activity.lastName
      ].filter(Boolean).join(' ') || 'Member';

      const quarterLabel = `Q${quarterlyData.quarter} ${quarterlyData.year}`;
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      const pdfFileName = `SkyCity_Quarterly_Statement_${targetPlayer.account}_${quarterLabel}.pdf`;

      const msg = {
        to: targetPlayer.activity.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: `Your SkyCity Quarterly Statement - ${quarterLabel}`,
        text: `Dear ${playerName},\n\nPlease find attached your quarterly statement for ${quarterLabel}.\n\nThank you for being a valued member of SkyCity.\n\nBest regards,\nSkyCity Team`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Dear ${playerName},</h2>
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
        ]
      };

      // Send email via SendGrid
      await sgMail.send(msg);

      return NextResponse.json({
        success: true,
        message: `PDF sent successfully to ${targetPlayer.activity.email}`,
        email: targetPlayer.activity.email
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Error sending PDF:', error);
    
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


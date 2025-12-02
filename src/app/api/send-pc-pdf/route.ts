import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import sgMail from '@sendgrid/mail';
import { generatePreCommitmentPDFHTML } from '@/lib/pc-no-play-pdf-template';
import { generatePlayPreCommitmentPDFHTML } from '@/lib/pc-play-pdf-template';
import { PreCommitmentPDFRequest, PreCommitmentPlayer } from '@/types/player-data';
import { getMemberByAccount } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export async function POST(request: NextRequest) {
  try {
    const body: PreCommitmentPDFRequest = await request.json();
    const { players } = body;

    if (!players || players.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No pre-commitment player data provided' },
        { status: 400 }
      );
    }

    if (!process.env.SENDGRID_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'SendGrid API key not configured' },
        { status: 500 }
      );
    }

    // Get the first player (single player per request)
    const playerData = players[0];

    // Fetch member data from database
    let memberData = null;
    try {
      memberData = await getMemberByAccount(playerData.playerInfo.playerAccount);
    } catch (error) {
      console.error('Error fetching member data:', error);
    }

    if (!memberData || !memberData.email) {
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
      
      // Determine which template to use based on player status
      const isPlay = playerData.noPlayStatus === 'Play';
      
      // Convert appropriate logo to base64
      const logoFileName = 'no-play-header.png';
      const logoPath = join(process.cwd(), 'public', logoFileName);
      const logoBuffer = readFileSync(logoPath);
      const logoBase64 = logoBuffer.toString('base64');
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      // Generate PDF using appropriate template
      const html = isPlay 
        ? generatePlayPreCommitmentPDFHTML(playerData, logoDataUrl, memberData)
        : generatePreCommitmentPDFHTML(playerData, logoDataUrl, memberData);
      
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
        memberData.title,
        memberData.first_name,
        memberData.last_name
      ].filter(Boolean).join(' ') || 'Member';

      const statementPeriod = playerData.statementPeriod || 'Current Period';
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      const pdfFileName = `SkyCity_PreCommitment_Statement_${playerData.playerInfo.playerAccount}_${statementPeriod.replace(/\s+/g, '_')}.pdf`;

      const msg = {
        to: memberData.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skycity.com',
        subject: `Your SkyCity Pre-Commitment Statement - ${statementPeriod}`,
        text: `Dear ${playerName},\n\nPlease find attached your pre-commitment statement for ${statementPeriod}.\n\nThank you for being a valued member of SkyCity.\n\nBest regards,\nSkyCity Team`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Dear ${playerName},</h2>
            <p>Please find attached your pre-commitment statement for <strong>${statementPeriod}</strong>.</p>
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
        message: `PDF sent successfully to ${memberData.email}`,
        email: memberData.email
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



import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { generatePreCommitmentPDFHTML } from '@/lib/pc-pdf-template';
import { PreCommitmentPDFRequest, PreCommitmentPlayer } from '@/types/player-data';
import { getMemberByAccount } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

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
      const logoPath = join(process.cwd(), 'public', 'no-play-header.png');
      const logoBuffer = readFileSync(logoPath);
      const logoBase64 = logoBuffer.toString('base64');
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      // Generate PDF for the first player (single player per request)
      const playerData = players[0];
      
      // Fetch member data from database
      let memberData = null;
      try {
        memberData = await getMemberByAccount(playerData.playerInfo.playerAccount);
      } catch (error) {
        console.error('Error fetching member data:', error);
        // Continue without member data if fetch fails
      }
      
      const html = generatePreCommitmentPDFHTML(playerData, logoDataUrl, memberData);
      
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

      const fileName = `skycity-precommitment-${playerData.playerInfo.playerAccount}-${Date.now()}.pdf`;
      
      // Convert Buffer to ArrayBuffer for NextResponse
      return new NextResponse(pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength
      ) as ArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': pdfBuffer.length.toString(),
        },
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Error generating pre-commitment PDF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate pre-commitment PDF' },
      { status: 500 }
    );
  }
}

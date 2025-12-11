import { NextRequest, NextResponse } from 'next/server';
import { getNoPlayBatchById, getNoPlayPlayersByBatch, getMemberByAccount } from '@/lib/db';
import { generatePlayPreCommitmentPDFHTML } from '@/lib/pc-play-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const accountNumber = searchParams.get('account');
    const batchId = searchParams.get('batch');

    if (!accountNumber) {
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
    const normalizedAccount = normalizeAccount(accountNumber);
    const targetPlayer = players.find(
      p => normalizeAccount(p.account_number) === normalizedAccount && p.no_play_status === 'Play'
    );

    if (!targetPlayer) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this batch or is not a Play member' },
        { status: 404 }
      );
    }

    // Get member data if available
    const member = await getMemberByAccount(normalizedAccount);

    // Convert no-play header to base64
    const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
    const headerBuffer = readFileSync(headerPath);
    const headerBase64 = headerBuffer.toString('base64');
    const headerDataUrl = `data:image/png;base64,${headerBase64}`;

    // Generate HTML using the play template
    const html = generatePlayPreCommitmentPDFHTML(targetPlayer.player_data, headerDataUrl, member || null);

    // Generate and return PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

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

    const sanitizedAccount = accountNumber.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
    const statementPeriod = targetPlayer.player_data.statementPeriod || 'Current';
    const filename = `Play_PreCommitment_${sanitizedAccount}_${statementPeriod.replace(/\s+/g, '_')}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating play member PDF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}



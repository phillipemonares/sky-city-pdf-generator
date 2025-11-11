import { NextRequest, NextResponse } from 'next/server';
import { getMatchedAccountsByBatch, getBatchById } from '@/lib/db';
import { generateAnnotatedHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const accountNumber = searchParams.get('account');
    const batchId = searchParams.get('batch');
    const action = searchParams.get('action') || 'download'; // 'download' or 'preview'

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
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get matched accounts for this batch
    const matchedAccounts = await getMatchedAccountsByBatch(batchId);
    
    // Find the specific account
    const normalizedAccount = normalizeAccount(accountNumber);
    const targetAccount = matchedAccounts.find(
      acc => normalizeAccount(acc.account_number) === normalizedAccount
    );

    if (!targetAccount) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this batch' },
        { status: 404 }
      );
    }

    // Extract quarterly data from the account data
    const accountData = targetAccount.account_data;
    const quarterlyData = accountData.quarterlyData;

    if (!quarterlyData) {
      return NextResponse.json(
        { success: false, error: 'Quarterly data not found for this account' },
        { status: 404 }
      );
    }

    // Convert logo to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Generate HTML
    const html = generateAnnotatedHTML(accountData, quarterlyData, logoDataUrl);

    // If action is preview, return HTML with print button
    if (action === 'preview') {
      // Add print button to the HTML
      const htmlWithPrintButton = html.replace(
        '<body',
        `<body>
          <style>
            .print-button-container {
              position: fixed;
              top: 20px;
              right: 20px;
              z-index: 9999;
            }
            .print-button {
              background: #2563eb;
              color: white;
              padding: 12px 24px;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              transition: background 0.2s;
            }
            .print-button:hover {
              background: #1d4ed8;
            }
            @media print {
              .print-button-container {
                display: none;
              }
            }
          </style>
          <div class="print-button-container">
            <button class="print-button" onclick="window.print()">🖨️ Print</button>
          </div>
        <body`
      ).replace('<body>', '');

      return new NextResponse(htmlWithPrintButton, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      });
    }

    // Otherwise generate and return PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    await browser.close();

    const sanitizedAccount = accountNumber.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
    const filename = `Statement_Q${batch.quarter}_${batch.year}_${sanitizedAccount}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating member PDF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}


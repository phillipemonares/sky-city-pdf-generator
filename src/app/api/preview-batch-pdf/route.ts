import { NextRequest, NextResponse } from 'next/server';
import { getBatchById, getAccountFromBatch, getQuarterlyDataFromBatch } from '@/lib/db';
import { generatePreviewHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { readFileSync } from 'fs';
import { join } from 'path';

// Increase max duration for large data processing
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const account = searchParams.get('account');

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId parameter is required' },
        { status: 400 }
      );
    }

    // Get batch metadata
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get quarterly data (efficiently from one account)
    const quarterlyData = await getQuarterlyDataFromBatch(batchId);
    
    if (!quarterlyData) {
      return NextResponse.json(
        { success: false, error: 'No quarterly data found in batch' },
        { status: 400 }
      );
    }

    // Determine target account
    let targetAccountNumber: string;
    if (account) {
      targetAccountNumber = normalizeAccount(account);
    } else {
      // If no specific account requested, we need to get any account from the batch
      // For efficiency, we'll use the quarterly data query result's account
      return NextResponse.json(
        { success: false, error: 'Account parameter is required for preview' },
        { status: 400 }
      );
    }

    // Get the specific account data (optimized single query)
    const matchedAccount = await getAccountFromBatch(batchId, targetAccountNumber);
    
    if (!matchedAccount) {
      return NextResponse.json(
        { success: false, error: 'Requested account was not found in the batch' },
        { status: 404 }
      );
    }

    // Extract the target player data
    const targetPlayer = matchedAccount.account_data;

    // Ensure cashless is only included if it exists
    if (!targetPlayer.cashless) {
      console.log(`Cashless data not found for account ${targetPlayer.account}, excluding from preview`);
    }

    // Convert logos to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Convert play-header to base64 for pre-commitment section
    const playHeaderPath = join(process.cwd(), 'public', 'play-header.png');
    const playHeaderBuffer = readFileSync(playHeaderPath);
    const playHeaderBase64 = playHeaderBuffer.toString('base64');
    const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;

    const html = generatePreviewHTML(targetPlayer, quarterlyData, logoDataUrl, playHeaderDataUrl);

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

  } catch (error) {
    console.error('Error generating preview from batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate preview from batch' },
      { status: 500 }
    );
  }
}
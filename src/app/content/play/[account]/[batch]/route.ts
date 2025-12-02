import { NextRequest, NextResponse } from 'next/server';
import { getNoPlayBatchById, getNoPlayPlayersByBatch, getMemberByAccount } from '@/lib/db';
import { generatePlayPreCommitmentPDFHTML } from '@/lib/pc-play-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ account: string; batch: string }> }
) {
  try {
    const resolvedParams = await params;
    const accountNumber = resolvedParams.account;
    const batchId = resolvedParams.batch;

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
    console.error('Error generating play PDF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}


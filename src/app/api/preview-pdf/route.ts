import { NextRequest, NextResponse } from 'next/server';
import { buildAnnotatedPlayers, generateAnnotatedHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { AnnotatedPDFGenerationRequest } from '@/types/player-data';
import { readFileSync } from 'fs';
import { join } from 'path';

// Increase max duration for large data processing
export const maxDuration = 60;

// Force Node.js runtime to handle larger bodies
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Use request.json() directly - more memory efficient than manual stream reading
    // Next.js handles the body parsing more efficiently internally
    const body: AnnotatedPDFGenerationRequest = await request.json();
    const { activityRows, preCommitmentPlayers, quarterlyData } = body;

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

    const annotatedPlayers = buildAnnotatedPlayers(activityRows, preCommitmentPlayers, quarterlyData);

    if (annotatedPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No matching accounts found across uploads' },
        { status: 400 }
      );
    }

    const requestedAccount = normalizeAccount(body.account);
    const targetPlayer = requestedAccount
      ? annotatedPlayers.find(player => normalizeAccount(player.account) === requestedAccount)
      : annotatedPlayers[0];

    if (!targetPlayer) {
      return NextResponse.json(
        { success: false, error: 'Requested account was not found in the matched players' },
        { status: 404 }
      );
    }

    // Ensure cashless is only included if it exists (matches UI highlighting logic)
    // If cashless is not highlighted in UI, player.cashless will be undefined
    if (!targetPlayer.cashless) {
      console.log(`Cashless data not found for account ${targetPlayer.account}, excluding from preview`);
    }

    // Convert logos to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    // Convert play-header to base64 for pre-commitment section
    const playHeaderPath = join(process.cwd(), 'public', 'no-play-header.png');
    const playHeaderBuffer = readFileSync(playHeaderPath);
    const playHeaderBase64 = playHeaderBuffer.toString('base64');
    const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;

    const html = generateAnnotatedHTML(targetPlayer, quarterlyData, logoDataUrl, playHeaderDataUrl);

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
    console.error('Error generating preview:', error instanceof Error ? error.message : 'Unknown error');
    // Don't serialize the full error object to avoid memory issues with large payloads
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to generate preview' 
      },
      { status: 500 }
    );
  }
}

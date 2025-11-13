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
    // Read body as stream to bypass Next.js body size limit
    // This allows us to handle bodies larger than 10MB
    let rawBody = '';
    if (request.body) {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawBody += decoder.decode(value, { stream: true });
        }
        // Decode any remaining bytes
        rawBody += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    } else {
      // Fallback to standard method if body is not available as stream
      rawBody = await request.text();
    }
    
    if (!rawBody || rawBody.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Request body is empty' },
        { status: 400 }
      );
    }

    // Check if body was truncated (Next.js default limit is 10MB = 10485760 bytes)
    const bodySizeMB = rawBody.length / (1024 * 1024);
    if (rawBody.length >= 10485760) {
      console.warn(`Large body detected: ${bodySizeMB.toFixed(2)}MB. Body may be truncated.`);
    }

    // Check if JSON appears truncated (ends abruptly)
    const trimmedBody = rawBody.trim();
    const lastChar = trimmedBody[trimmedBody.length - 1];
    if (lastChar !== '}' && lastChar !== ']' && !trimmedBody.endsWith('"')) {
      console.error('Body appears to be truncated - does not end with valid JSON terminator');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Request body appears to be truncated. The payload is too large (exceeds 10MB limit). Please reduce the data size or split the request.',
          bodyLength: rawBody.length,
          bodySizeMB: bodySizeMB.toFixed(2),
          suggestion: 'Consider filtering the data to only include necessary records before sending.'
        },
        { status: 413 }
      );
    }

    // Parse JSON with better error handling
    let body: AnnotatedPDFGenerationRequest;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Body length:', rawBody.length);
      console.error('Body size (MB):', bodySizeMB.toFixed(2));
      console.error('Body preview (first 500 chars):', rawBody.substring(0, 500));
      console.error('Body ending (last 200 chars):', rawBody.substring(Math.max(0, rawBody.length - 200)));
      
      // Check if error is due to truncation
      if (rawBody.length >= 10485760) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Request body exceeds 10MB limit and was truncated. Please reduce the data size.',
            bodyLength: rawBody.length,
            bodySizeMB: bodySizeMB.toFixed(2),
            suggestion: 'Consider filtering data to only include necessary records or split into multiple requests.'
          },
          { status: 413 }
        );
      }
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
          bodyLength: rawBody.length,
          bodySizeMB: bodySizeMB.toFixed(2)
        },
        { status: 400 }
      );
    }
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
    const playHeaderPath = join(process.cwd(), 'public', 'play-header.png');
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
    console.error('Error generating preview:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}

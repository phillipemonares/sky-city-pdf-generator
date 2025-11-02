import { NextRequest, NextResponse } from 'next/server';
import { buildAnnotatedPlayers, generateAnnotatedHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { AnnotatedPDFGenerationRequest } from '@/types/player-data';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
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

    // Convert logo to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;

    const html = generateAnnotatedHTML(targetPlayer, quarterlyData, logoDataUrl);

    return new NextResponse(html, {
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

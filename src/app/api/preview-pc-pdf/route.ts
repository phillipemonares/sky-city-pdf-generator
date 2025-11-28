import { NextRequest, NextResponse } from 'next/server';
import { generatePreCommitmentPDFHTML } from '@/lib/pc-no-play-pdf-template';
import { generatePlayPreCommitmentPDFHTML } from '@/lib/pc-play-pdf-template';
import { PreCommitmentPDFRequest, PreCommitmentPlayer } from '@/types/player-data';
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

    // Generate HTML for the first player (single player per request)
    const playerData = players[0];
    
    // Determine which template to use based on player status
    const isPlay = playerData.noPlayStatus === 'Play';
    
    // Convert appropriate logo to base64
    const logoFileName = isPlay ? 'play-header.png' : 'no-play-header.png';
    const logoPath = join(process.cwd(), 'public', logoFileName);
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;
    
    // Generate HTML using appropriate template
    const html = isPlay 
      ? generatePlayPreCommitmentPDFHTML(playerData, logoDataUrl, null)
      : generatePreCommitmentPDFHTML(playerData, logoDataUrl, null);
    
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    });

  } catch (error) {
    console.error('Error generating pre-commitment preview:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate pre-commitment preview' },
      { status: 500 }
    );
  }
}

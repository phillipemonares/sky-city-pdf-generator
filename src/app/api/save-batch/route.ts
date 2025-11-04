import { NextRequest, NextResponse } from 'next/server';
import { saveGenerationBatch } from '@/lib/db';
import { buildAnnotatedPlayers } from '@/lib/annotated-pdf-template';
import { AnnotatedPDFGenerationRequest } from '@/types/player-data';

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

    // Build annotated players
    const annotatedPlayers = buildAnnotatedPlayers(
      activityRows,
      preCommitmentPlayers,
      quarterlyData
    );

    if (annotatedPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No matching accounts found across uploads' },
        { status: 400 }
      );
    }

    // Save to database
    const batchId = await saveGenerationBatch(
      quarterlyData.quarter,
      quarterlyData.year,
      annotatedPlayers,
      quarterlyData
    );

    return NextResponse.json({
      success: true,
      batchId,
      totalAccounts: annotatedPlayers.length,
      quarter: quarterlyData.quarter,
      year: quarterlyData.year,
    });
  } catch (error) {
    console.error('Error saving batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save batch to database' },
      { status: 500 }
    );
  }
}



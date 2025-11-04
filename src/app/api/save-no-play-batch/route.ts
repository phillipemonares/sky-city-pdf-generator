import { NextRequest, NextResponse } from 'next/server';
import { saveNoPlayBatch } from '@/lib/db';
import { PreCommitmentPDFRequest } from '@/types/player-data';

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

    // Get statement period and date from first player (all should have the same)
    const statementPeriod = players[0].statementPeriod || 'Current Period';
    const statementDate = players[0].statementDate || new Date().toLocaleDateString();

    // Save to database
    const batchId = await saveNoPlayBatch(statementPeriod, statementDate, players);

    return NextResponse.json({
      success: true,
      batchId,
      totalPlayers: players.length,
      statementPeriod,
      statementDate,
    });
  } catch (error) {
    console.error('Error saving no-play batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save batch to database' },
      { status: 500 }
    );
  }
}



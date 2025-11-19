import { NextRequest, NextResponse } from 'next/server';
import { getNoPlayBatchById, getNoPlayPlayersByBatch } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId parameter is required' },
        { status: 400 }
      );
    }

    // Get batch metadata
    const batch = await getNoPlayBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get players
    const players = await getNoPlayPlayersByBatch(batchId);

    // Extract player data
    const playerData = players.map(p => p.player_data);

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        statement_period: batch.statement_period,
        statement_date: batch.statement_date,
        generation_date: batch.generation_date.toISOString(),
        total_players: batch.total_players,
      },
      players: playerData,
    });
  } catch (error) {
    console.error('Error loading no-play batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load batch' },
      { status: 500 }
    );
  }
}










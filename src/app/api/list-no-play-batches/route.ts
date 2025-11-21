import { NextRequest, NextResponse } from 'next/server';
import { getAllNoPlayBatches } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const batches = await getAllNoPlayBatches();
    
    return NextResponse.json({
      success: true,
      batches: batches.map(batch => ({
        id: batch.id,
        statement_period: batch.statement_period,
        statement_date: batch.statement_date,
        generation_date: batch.generation_date.toISOString(),
        total_players: batch.total_players,
        created_at: batch.created_at.toISOString(),
        updated_at: batch.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching no-play batches:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch batches' },
      { status: 500 }
    );
  }
}











import { NextRequest, NextResponse } from 'next/server';
import { getAllBatches } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const batches = await getAllBatches();
    
    return NextResponse.json({
      success: true,
      batches: batches.map(batch => ({
        id: batch.id,
        quarter: batch.quarter,
        year: batch.year,
        generation_date: batch.generation_date.toISOString(),
        total_accounts: batch.total_accounts,
        created_at: batch.created_at.toISOString(),
        updated_at: batch.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching batches:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch batches' },
      { status: 500 }
    );
  }
}



import { NextRequest, NextResponse } from 'next/server';
import { getBatchById, getMatchedAccountsByBatch } from '@/lib/db';

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
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Get matched accounts
    const matchedAccounts = await getMatchedAccountsByBatch(batchId);

    // Extract annotated players and quarterly data
    const annotatedPlayers = matchedAccounts.map(acc => acc.account_data);
    
    // Extract quarterly data from the first account (all accounts should have the same quarterlyData)
    // The quarterlyData is stored as a property in the account_data object
    const quarterlyData = (annotatedPlayers[0] as any)?.quarterlyData || null;
    
    // Clean up the quarterlyData from the account_data objects
    const cleanedPlayers = annotatedPlayers.map(player => {
      const { quarterlyData: _, ...rest } = player as any;
      return rest;
    });

    // Reconstruct activity rows, pre-commitment players
    const activityRows = cleanedPlayers
      .filter(p => p.activity)
      .map(p => p.activity);

    const preCommitmentPlayers = cleanedPlayers
      .filter(p => p.preCommitment)
      .map(p => p.preCommitment);

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        quarter: batch.quarter,
        year: batch.year,
        generation_date: batch.generation_date.toISOString(),
        total_accounts: batch.total_accounts,
      },
      annotatedPlayers: cleanedPlayers,
      activityRows,
      preCommitmentPlayers,
      quarterlyData,
    });
  } catch (error) {
    console.error('Error loading batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load batch' },
      { status: 500 }
    );
  }
}


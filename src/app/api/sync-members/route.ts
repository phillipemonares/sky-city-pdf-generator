import { NextRequest, NextResponse } from 'next/server';
import { syncMembersFromBatches } from '@/lib/db';

// Increase timeout for large syncs (25k+ members)
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const result = await syncMembersFromBatches();
    
    return NextResponse.json({
      success: true,
      message: `Successfully synced members from all batches. ${result.savedCount} new members added, ${result.updatedCount} members updated, ${result.totalProcessed} total processed.`,
      ...result
    });
  } catch (error) {
    console.error('Error syncing members:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to sync members from batches' 
      },
      { status: 500 }
    );
  }
}


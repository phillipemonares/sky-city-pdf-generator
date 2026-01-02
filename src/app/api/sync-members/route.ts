import { NextRequest, NextResponse } from 'next/server';
import { syncMembersFromBatches } from '@/lib/db';

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


import { NextRequest, NextResponse } from 'next/server';
import { saveMembersFromActivity } from '@/lib/db';
import { ActivityStatementRow } from '@/types/player-data';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { activityRows } = body;

    if (!activityRows || activityRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No activity statement data provided' },
        { status: 400 }
      );
    }

    // Save members to database
    const savedCount = await saveMembersFromActivity(activityRows);

    // Calculate updated count (total - new)
    const updatedCount = activityRows.length - savedCount;

    return NextResponse.json({
      success: true,
      savedCount,
      updatedCount,
      totalProcessed: activityRows.length,
    });
  } catch (error) {
    console.error('Error saving members:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save members to database' },
      { status: 500 }
    );
  }
}


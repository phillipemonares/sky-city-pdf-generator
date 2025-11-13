import { NextRequest, NextResponse } from 'next/server';
import { deleteMembers } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { memberIds } = body;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Member IDs array is required' },
        { status: 400 }
      );
    }

    const deletedCount = await deleteMembers(memberIds);

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${deletedCount} member(s)`,
      deletedCount,
    });
  } catch (error) {
    console.error('Error deleting members:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete members' },
      { status: 500 }
    );
  }
}


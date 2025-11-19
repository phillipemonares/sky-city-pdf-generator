import { NextRequest, NextResponse } from 'next/server';
import { deleteBatch } from '@/lib/db';

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId parameter is required' },
        { status: 400 }
      );
    }

    const deleted = await deleteBatch(batchId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete batch' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Batch deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete batch' },
      { status: 500 }
    );
  }
}










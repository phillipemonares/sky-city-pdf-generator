import { NextRequest, NextResponse } from 'next/server';
import { getAllPdfExports } from '@/lib/db';

/**
 * GET /api/export-pdfs-bulk/list
 * Get all PDF export jobs
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');

    const exports = await getAllPdfExports(limit);

    return NextResponse.json({
      success: true,
      exports: exports.map(exp => ({
        id: exp.id,
        tab_type: exp.tab_type,
        status: exp.status,
        total_members: exp.total_members,
        processed_members: exp.processed_members,
        failed_members: exp.failed_members,
        file_size: exp.file_size,
        error_message: exp.error_message,
        created_at: exp.created_at.toISOString(),
        updated_at: exp.updated_at.toISOString(),
        started_at: exp.started_at?.toISOString() || null,
        completed_at: exp.completed_at?.toISOString() || null,
        progress_percentage: exp.total_members > 0
          ? Math.round((exp.processed_members / exp.total_members) * 100)
          : 0,
      }))
    });
  } catch (error) {
    console.error('Error getting export list:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get export list' },
      { status: 500 }
    );
  }
}




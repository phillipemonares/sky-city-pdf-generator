import { NextRequest, NextResponse } from 'next/server';
import { getPdfExport } from '@/lib/db';

/**
 * GET /api/export-pdfs-bulk/[id]/status
 * Get the status of a PDF export job
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const exportId = resolvedParams.id;

    if (!exportId) {
      return NextResponse.json(
        { success: false, error: 'Export ID is required' },
        { status: 400 }
      );
    }

    const exportJob = await getPdfExport(exportId);

    if (!exportJob) {
      return NextResponse.json(
        { success: false, error: 'Export job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      export: {
        id: exportJob.id,
        tab_type: exportJob.tab_type,
        status: exportJob.status,
        total_members: exportJob.total_members,
        processed_members: exportJob.processed_members,
        failed_members: exportJob.failed_members,
        file_size: exportJob.file_size,
        error_message: exportJob.error_message,
        created_at: exportJob.created_at.toISOString(),
        updated_at: exportJob.updated_at.toISOString(),
        started_at: exportJob.started_at?.toISOString() || null,
        completed_at: exportJob.completed_at?.toISOString() || null,
        progress_percentage: exportJob.total_members > 0
          ? Math.round((exportJob.processed_members / exportJob.total_members) * 100)
          : 0,
      }
    });
  } catch (error) {
    console.error('Error getting export status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get export status' },
      { status: 500 }
    );
  }
}























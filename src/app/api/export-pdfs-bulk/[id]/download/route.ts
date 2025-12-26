import { NextRequest, NextResponse } from 'next/server';
import { getPdfExport } from '@/lib/db';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * GET /api/export-pdfs-bulk/[id]/download
 * Download the completed PDF export zip file
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

    if (exportJob.status !== 'completed') {
      return NextResponse.json(
        { 
          success: false, 
          error: `Export is not completed. Current status: ${exportJob.status}` 
        },
        { status: 400 }
      );
    }

    if (!exportJob.file_path || !existsSync(exportJob.file_path)) {
      return NextResponse.json(
        { success: false, error: 'Export file not found' },
        { status: 404 }
      );
    }

    // Read the zip file
    const fileBuffer = await readFile(exportJob.file_path);
    
    // Generate filename
    const dateStr = new Date(exportJob.created_at).toISOString().split('T')[0];
    const filename = `${exportJob.tab_type}_members_pdfs_${dateStr}_${exportId.substring(0, 8)}.zip`;

    // Convert Buffer to Uint8Array for NextResponse (Uint8Array is a valid BodyInit)
    const uint8Array = new Uint8Array(fileBuffer);

    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error downloading export:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to download export' },
      { status: 500 }
    );
  }
}











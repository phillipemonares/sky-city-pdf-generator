import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import archiver from 'archiver';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const folderName = searchParams.get('folder');

    if (!folderName) {
      return NextResponse.json(
        { success: false, error: 'Folder name is required' },
        { status: 400 }
      );
    }

    // Sanitize folder name to prevent directory traversal
    const sanitizedFolderName = folderName.replace(/[^a-zA-Z0-9_-]/g, '');
    const folderPath = join(UPLOADS_DIR, sanitizedFolderName);

    // Check if folder exists
    if (!existsSync(folderPath)) {
      return NextResponse.json(
        { success: false, error: 'Folder not found' },
        { status: 404 }
      );
    }

    // Verify it's a directory
    const stats = await stat(folderPath);
    if (!stats.isDirectory()) {
      return NextResponse.json(
        { success: false, error: 'Path is not a directory' },
        { status: 400 }
      );
    }

    // Create a streaming zip archive
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Compression level
    });

    // Convert archiver stream to ReadableStream for Next.js
    const stream = new ReadableStream({
      start(controller) {
        archive.on('data', (chunk) => {
          controller.enqueue(chunk);
        });

        archive.on('end', () => {
          controller.close();
        });

        archive.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    // Recursively add files to archive (streaming, not loading into memory)
    addFolderToArchive(archive, folderPath, sanitizedFolderName);

    // Finalize the archive
    archive.finalize();

    // Return streaming response
    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${sanitizedFolderName}.zip"`,
        // Don't set Content-Length for streaming responses
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Error creating zip file:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create zip file',
      },
      { status: 500 }
    );
  }
}

/**
 * Recursively add folder contents to archive (streaming)
 */
function addFolderToArchive(
  archive: archiver.Archiver,
  folderPath: string,
  zipPath: string
): void {
  const items = readdir.sync(folderPath);

  for (const item of items) {
    // Skip hidden files
    if (item.startsWith('.')) {
      continue;
    }

    const itemPath = join(folderPath, item);
    const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
    const stats = stat.sync(itemPath);

    if (stats.isDirectory()) {
      // Recursively add subdirectories
      addFolderToArchive(archive, itemPath, itemZipPath);
    } else {
      // Add file to archive using stream (not loading into memory)
      archive.file(itemPath, { name: itemZipPath });
    }
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import JSZip from 'jszip';

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

    // Create zip file
    const zip = new JSZip();

    // Recursively add all files to zip
    await addFolderToZip(zip, folderPath, sanitizedFolderName);

    // Generate zip file
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // Return zip file as response
    // Convert Buffer to Uint8Array for NextResponse (Uint8Array is a valid BodyInit)
    const uint8Array = new Uint8Array(zipBuffer);
    
    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${sanitizedFolderName}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
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
 * Recursively add folder contents to zip
 */
async function addFolderToZip(
  zip: JSZip,
  folderPath: string,
  zipPath: string
): Promise<void> {
  const items = await readdir(folderPath);

  for (const item of items) {
    // Skip hidden files
    if (item.startsWith('.')) {
      continue;
    }

    const itemPath = join(folderPath, item);
    const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
    const stats = await stat(itemPath);

    if (stats.isDirectory()) {
      // Recursively add subdirectories
      await addFolderToZip(zip, itemPath, itemZipPath);
    } else {
      // Add file to zip
      const fileContent = await readFile(itemPath);
      zip.file(itemZipPath, fileContent);
    }
  }
}


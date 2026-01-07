import { NextRequest, NextResponse } from 'next/server';
import { readdirSync, statSync, createReadStream, createWriteStream } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import archiver from 'archiver';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
const ZIP_CACHE_DIR = join(UPLOADS_DIR, '.zips');

// Ensure zip cache directory exists
async function ensureZipCacheDir() {
  if (!existsSync(ZIP_CACHE_DIR)) {
    await mkdir(ZIP_CACHE_DIR, { recursive: true });
  }
}

/**
 * Get the path to the cached zip file for a folder
 */
function getCachedZipPath(folderName: string): string {
  return join(ZIP_CACHE_DIR, `${folderName}.zip`);
}

/**
 * Check if cached zip exists and is up-to-date
 */
function isZipCacheValid(folderPath: string, zipPath: string): boolean {
  if (!existsSync(zipPath)) {
    return false;
  }

  try {
    const folderStats = statSync(folderPath);
    const zipStats = statSync(zipPath);

    // Zip is valid if it was created after the folder was last modified
    return zipStats.mtime >= folderStats.mtime;
  } catch {
    return false;
  }
}

/**
 * Create a zip file and save it to cache
 */
async function createZipFile(
  folderPath: string,
  zipPath: string,
  folderName: string
): Promise<void> {
  await ensureZipCacheDir();

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Compression level
    });

    output.on('close', () => {
      console.log(`Zip file created: ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Recursively add files to archive
    addFolderToArchive(archive, folderPath, folderName);

    // Finalize the archive
    archive.finalize();
  });
}

/**
 * Stream a file as a response
 */
async function streamFileAsResponse(
  filePath: string,
  filename: string
): Promise<NextResponse> {
  const stats = statSync(filePath);
  const fileStream = createReadStream(filePath);

  // Convert Node.js ReadableStream to Web ReadableStream
  const webStream = new ReadableStream({
    start(controller) {
      fileStream.on('data', (chunk) => {
        controller.enqueue(chunk);
      });
      fileStream.on('end', () => {
        controller.close();
      });
      fileStream.on('error', (err) => {
        controller.error(err);
      });
    },
    cancel() {
      fileStream.destroy();
    },
  });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}.zip"`,
      'Content-Length': stats.size.toString(),
    },
  });
}

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
    const stats = statSync(folderPath);
    if (!stats.isDirectory()) {
      return NextResponse.json(
        { success: false, error: 'Path is not a directory' },
        { status: 400 }
      );
    }

    // Check if we have a valid cached zip file
    const cachedZipPath = getCachedZipPath(sanitizedFolderName);
    
    if (isZipCacheValid(folderPath, cachedZipPath)) {
      // Stream the cached zip file directly - this is fast!
      console.log(`Serving cached zip file for ${sanitizedFolderName}`);
      return await streamFileAsResponse(cachedZipPath, sanitizedFolderName);
    }

    // Zip doesn't exist or is outdated - create it
    console.log(`Creating zip file for ${sanitizedFolderName}...`);
    await createZipFile(folderPath, cachedZipPath, sanitizedFolderName);

    // Now stream the newly created zip file
    return await streamFileAsResponse(cachedZipPath, sanitizedFolderName);
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
  const items = readdirSync(folderPath);

  for (const item of items) {
    // Skip hidden files
    if (item.startsWith('.')) {
      continue;
    }

    const itemPath = join(folderPath, item);
    const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
    const stats = statSync(itemPath);

    if (stats.isDirectory()) {
      // Recursively add subdirectories
      addFolderToArchive(archive, itemPath, itemZipPath);
    } else {
      // Add file to archive using stream (not loading into memory)
      archive.file(itemPath, { name: itemZipPath });
    }
  }
}


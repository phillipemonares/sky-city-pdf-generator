import { NextRequest, NextResponse } from 'next/server';
import { statSync, createReadStream } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

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
    
    // Check for zip file in uploads directory (created by the bash script)
    const zipPath = join(UPLOADS_DIR, `${sanitizedFolderName}.zip`);

    if (!existsSync(zipPath)) {
      return NextResponse.json(
        { success: false, error: 'ZIP file not found. Please run the zip script first.' },
        { status: 404 }
      );
    }

    // Stream the zip file directly - fast download!
    console.log(`Serving zip file: ${zipPath}`);
    return await streamFileAsResponse(zipPath, sanitizedFolderName);
  } catch (error) {
    console.error('Error downloading zip file:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download zip file',
      },
      { status: 500 }
    );
  }
}


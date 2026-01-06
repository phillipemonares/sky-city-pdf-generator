import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

export async function GET(request: NextRequest) {
  try {
    // Check if uploads directory exists
    if (!existsSync(UPLOADS_DIR)) {
      return NextResponse.json({
        success: true,
        folders: [],
      });
    }

    // Read all items in uploads directory
    const items = await readdir(UPLOADS_DIR);

    // Filter for directories only and get their stats
    const folders = await Promise.all(
      items.map(async (item) => {
        const itemPath = join(UPLOADS_DIR, item);
        try {
          const stats = await stat(itemPath);
          if (stats.isDirectory()) {
            // Count files in the folder
            const folderContents = await readdir(itemPath);
            const files = folderContents.filter(
              (file) => !file.startsWith('.') // Exclude hidden files
            );

            return {
              name: item,
              fileCount: files.length,
              size: await calculateFolderSize(itemPath),
              lastModified: stats.mtime.toISOString(),
            };
          }
          return null;
        } catch (error) {
          console.error(`Error reading folder ${item}:`, error);
          return null;
        }
      })
    );

    // Filter out null values and sort by name (most recent first, assuming naming like q3-2025)
    const validFolders = folders
      .filter((folder): folder is NonNullable<typeof folder> => folder !== null)
      .sort((a, b) => b.name.localeCompare(a.name)); // Sort descending (newest first)

    return NextResponse.json({
      success: true,
      folders: validFolders,
    });
  } catch (error) {
    console.error('Error listing upload folders:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list folders',
      },
      { status: 500 }
    );
  }
}

/**
 * Calculate total size of a folder
 */
async function calculateFolderSize(folderPath: string): Promise<number> {
  try {
    const items = await readdir(folderPath);
    let totalSize = 0;

    for (const item of items) {
      const itemPath = join(folderPath, item);
      const stats = await stat(itemPath);

      if (stats.isDirectory()) {
        totalSize += await calculateFolderSize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }

    return totalSize;
  } catch (error) {
    console.error(`Error calculating folder size for ${folderPath}:`, error);
    return 0;
  }
}



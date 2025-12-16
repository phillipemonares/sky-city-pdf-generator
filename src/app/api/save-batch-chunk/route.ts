import { NextRequest, NextResponse } from 'next/server';
import { saveMembersFromActivity } from '@/lib/db';
import { buildAnnotatedPlayers } from '@/lib/annotated-pdf-template';
import { AnnotatedPDFGenerationRequest, QuarterlyData, PreCommitmentPlayer } from '@/types/player-data';
import { randomUUID } from 'crypto';
import mysql from 'mysql2/promise';
import { encryptJson, encryptDeterministic } from '@/lib/encryption';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

// In-memory cache for batch metadata (quarterlyData and preCommitmentPlayers)
// This avoids sending large data with every chunk request
// Cache expires after 1 hour or when batch is finalized
const batchMetadataCache = new Map<string, {
  quarterlyData: QuarterlyData;
  preCommitmentPlayers: PreCommitmentPlayer[];
  timestamp: number;
}>();

// Clean up old cache entries (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [batchId, data] of batchMetadataCache.entries()) {
    if (data.timestamp < oneHourAgo) {
      batchMetadataCache.delete(batchId);
    }
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const connection = await pool.getConnection();
  
  try {
    // Use request.json() directly - more memory efficient than manual parsing
    const body = await request.json();
    const { batchId, activityRows, preCommitmentPlayers, quarterlyData } = body;

    if (!batchId || !activityRows) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: batchId, activityRows' },
        { status: 400 }
      );
    }

    // Try to get quarterlyData and preCommitmentPlayers from cache first
    // If not in cache, use from request body (backward compatibility)
    let finalQuarterlyData = quarterlyData;
    let finalPreCommitmentPlayers = preCommitmentPlayers;
    
    const cachedMetadata = batchMetadataCache.get(batchId);
    if (cachedMetadata) {
      finalQuarterlyData = cachedMetadata.quarterlyData;
      finalPreCommitmentPlayers = cachedMetadata.preCommitmentPlayers;
    } else if (!quarterlyData || !preCommitmentPlayers) {
      // Try to fetch from database batch metadata
      try {
        const [batchRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT quarterly_data FROM generation_batches WHERE id = ?`,
          [batchId]
        );
        
        if (batchRows.length > 0 && batchRows[0].quarterly_data) {
          const metadata = JSON.parse(batchRows[0].quarterly_data);
          finalQuarterlyData = metadata.quarterlyData;
          finalPreCommitmentPlayers = metadata.preCommitmentPlayers;
          // Cache it for future chunk requests
          batchMetadataCache.set(batchId, {
            quarterlyData: finalQuarterlyData,
            preCommitmentPlayers: finalPreCommitmentPlayers,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        // Column might not exist, continue with request body data
      }
    }

    if (!finalQuarterlyData || !finalPreCommitmentPlayers) {
      return NextResponse.json(
        { success: false, error: 'Missing quarterlyData or preCommitmentPlayers. Please send them in the request or ensure batch was initialized with them.' },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    // Save members from activity statement (unique members only)
    try {
      await saveMembersFromActivity(activityRows);
    } catch (memberError) {
      // Continue even if member saving fails
    }

    // Build annotated players for this chunk
    const annotatedPlayers = buildAnnotatedPlayers(
      activityRows,
      finalPreCommitmentPlayers,
      finalQuarterlyData
    );

    // Insert user statements using batch inserts
    const chunkSize = 1000;
    const totalPlayers = annotatedPlayers.length;

    for (let i = 0; i < totalPlayers; i += chunkSize) {
      const chunk = annotatedPlayers.slice(i, i + chunkSize);
      const values: any[] = [];
      const placeholders: string[] = [];

      for (const player of chunk) {
        const statementId = randomUUID();

        // Don't store quarterlyData in each player record to save memory
        // It will be retrieved from the batch metadata when needed
        const userData = {
          activity_statement: player.activity || null,
          pre_commitment: player.preCommitment || null,
          cashless_statement: player.cashless || null,
          // quarterlyData is stored once per batch, not per player
        };

        // Encrypt data and account number for consistency with saveGenerationBatch
        const dataJson = encryptJson(userData);
        const encryptedAccountNumber = encryptDeterministic(player.account);

        values.push(statementId, batchId, encryptedAccountNumber, dataJson);
        placeholders.push('(?, ?, ?, ?)');
      }

      const sql = `INSERT INTO quarterly_user_statements 
                   (id, batch_id, account_number, data)
                   VALUES ${placeholders.join(', ')}`;

      await connection.execute(sql, values);
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      savedCount: annotatedPlayers.length,
    });
  } catch (error) {
    await connection.rollback();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error saving chunk:', errorMessage);
    return NextResponse.json(
      { success: false, error: 'Failed to save chunk', details: errorMessage },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}


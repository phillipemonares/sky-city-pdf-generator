import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import mysql from 'mysql2/promise';

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

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const connection = await pool.getConnection();
  
  try {
    // Use request.json() directly - more memory efficient than manual parsing
    const body = await request.json();
    const { quarter, year, totalAccounts, quarterlyData, preCommitmentPlayers, startDate, endDate } = body;

    if (!quarter || !year || !totalAccounts) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: quarter, year, totalAccounts' },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const batchId = randomUUID();
    const generationDate = new Date();

    // Store quarterlyData and preCommitmentPlayers as JSON in the batch metadata
    // This avoids sending them with every chunk request
    const batchMetadata = quarterlyData && preCommitmentPlayers ? JSON.stringify({
      quarterlyData,
      preCommitmentPlayers,
    }) : null;

    // Convert date strings to Date objects or null
    const startDateValue = startDate ? new Date(startDate) : null;
    const endDateValue = endDate ? new Date(endDate) : null;

    // Check if quarterly_data column exists, if not, just store without it
    // For now, we'll try to store it, but handle gracefully if column doesn't exist
    try {
      await connection.execute(
        `INSERT INTO generation_batches (id, quarter, year, generation_date, total_accounts, start_date, end_date, quarterly_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchId, quarter, year, generationDate, totalAccounts, startDateValue, endDateValue, batchMetadata]
      );
    } catch (error: any) {
      // If quarterly_data column doesn't exist, insert without it
      if (error.code === 'ER_BAD_FIELD_ERROR') {
        try {
          await connection.execute(
            `INSERT INTO generation_batches (id, quarter, year, generation_date, total_accounts, start_date, end_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [batchId, quarter, year, generationDate, totalAccounts, startDateValue, endDateValue]
          );
        } catch (innerError: any) {
          // If start_date/end_date columns don't exist, insert without them
          if (innerError.code === 'ER_BAD_FIELD_ERROR') {
            await connection.execute(
              `INSERT INTO generation_batches (id, quarter, year, generation_date, total_accounts)
               VALUES (?, ?, ?, ?, ?)`,
              [batchId, quarter, year, generationDate, totalAccounts]
            );
          } else {
            throw innerError;
          }
        }
      } else {
        throw error;
      }
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      batchId,
    });
  } catch (error) {
    await connection.rollback();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error initializing batch:', errorMessage);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize batch', details: errorMessage },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}


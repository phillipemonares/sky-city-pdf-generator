import { NextRequest, NextResponse } from 'next/server';
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
  try {
    const body = await request.json();
    const { batchId, startDate, endDate } = body;

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'Missing batchId' },
        { status: 400 }
      );
    }

    // Get the actual count of saved statements
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM quarterly_user_statements WHERE batch_id = ?`,
      [batchId]
    );

    const actualCount = rows[0]?.count || 0;

    // Convert date strings to Date objects or null
    const startDateValue = startDate ? new Date(startDate) : null;
    const endDateValue = endDate ? new Date(endDate) : null;

    // Update the batch with the actual count and dates
    if (startDateValue && endDateValue) {
      await pool.execute(
        `UPDATE generation_batches SET total_accounts = ?, start_date = ?, end_date = ? WHERE id = ?`,
        [actualCount, startDateValue, endDateValue, batchId]
      );
    } else {
      await pool.execute(
        `UPDATE generation_batches SET total_accounts = ? WHERE id = ?`,
        [actualCount, batchId]
      );
    }

    // Get batch details
    const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT quarter, year, start_date, end_date FROM generation_batches WHERE id = ?`,
      [batchId]
    );

    if (batchRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      batchId,
      quarter: batchRows[0].quarter,
      year: batchRows[0].year,
      totalAccounts: actualCount,
      startDate: batchRows[0].start_date ? new Date(batchRows[0].start_date).toISOString().split('T')[0] : null,
      endDate: batchRows[0].end_date ? new Date(batchRows[0].end_date).toISOString().split('T')[0] : null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error finalizing batch:', errorMessage);
    return NextResponse.json(
      { success: false, error: 'Failed to finalize batch', details: errorMessage },
      { status: 500 }
    );
  }
}


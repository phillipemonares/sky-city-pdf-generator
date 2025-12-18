import { NextRequest, NextResponse } from 'next/server';
import { getBatchById, getMatchedAccountsByBatch } from '@/lib/db';
import { decryptJson, decrypt } from '@/lib/encryption';
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const search = searchParams.get('search')?.trim().toLowerCase() || '';

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId parameter is required' },
        { status: 400 }
      );
    }

    // Validate pagination parameters
    if (page < 1) {
      return NextResponse.json(
        { success: false, error: 'Page must be >= 1' },
        { status: 400 }
      );
    }
    if (pageSize < 1 || pageSize > 1000) {
      return NextResponse.json(
        { success: false, error: 'Page size must be between 1 and 1000' },
        { status: 400 }
      );
    }

    // Get batch metadata (including quarterlyData if stored)
    const batch = await getBatchById(batchId);
    if (!batch) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    // Try to get quarterlyData and preCommitmentPlayers from batch metadata
    let quarterlyData = null;
    let preCommitmentPlayers: any[] = [];
    
    try {
      const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT quarterly_data FROM generation_batches WHERE id = ?`,
        [batchId]
      );
      
      if (batchRows.length > 0 && batchRows[0].quarterly_data) {
        const metadata = JSON.parse(batchRows[0].quarterly_data);
        quarterlyData = metadata.quarterlyData || null;
        preCommitmentPlayers = metadata.preCommitmentPlayers || [];
      }
    } catch (error: any) {
      // Column might not exist (for existing batches created before this feature)
      // This is expected and not an error - just continue without it
      if (error.code !== 'ER_BAD_FIELD_ERROR') {
        console.log('Could not fetch quarterly_data from batch metadata:', error);
      }
    }

    // When searching, we need to fetch all records and filter in memory (since data is encrypted)
    // When not searching, use normal pagination
    let allMatchedPlayers: any[] = [];
    let allActivityRows: any[] = [];
    let allExtractedPreCommitmentPlayers: any[] = [];
    
    if (search) {
      // Fetch all records for this batch to search through
      const [allRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT account_number, data
         FROM quarterly_user_statements
         WHERE batch_id = ?
         ORDER BY account_number`,
        [batchId]
      );
      
      // Decrypt and filter
      for (const row of allRows) {
        const userData = decryptJson<{
          activity_statement?: any;
          pre_commitment?: any;
          cashless_statement?: any;
        }>(row.data);
        
        const account = decrypt(row.account_number || '');
        const firstName = (userData.activity_statement?.firstName || '').toLowerCase();
        const lastName = (userData.activity_statement?.lastName || '').toLowerCase();
        const email = (userData.activity_statement?.email || '').toLowerCase();
        const fullName = `${firstName} ${lastName}`;
        
        // Check if search term matches account, name, or email
        const matches = 
          account.toLowerCase().includes(search) ||
          firstName.includes(search) ||
          lastName.includes(search) ||
          fullName.includes(search) ||
          email.includes(search);
        
        if (matches) {
          const player = {
            account,
            activity: userData.activity_statement || undefined,
            preCommitment: userData.pre_commitment || undefined,
            cashless: userData.cashless_statement || undefined,
          };
          
          allMatchedPlayers.push(player);
          
          if (userData.activity_statement) {
            allActivityRows.push(userData.activity_statement);
          }
          
          if (preCommitmentPlayers.length === 0 && userData.pre_commitment) {
            allExtractedPreCommitmentPlayers.push(userData.pre_commitment);
          }
        }
      }
    }
    
    // Get total count for pagination
    const totalAccounts = search 
      ? allMatchedPlayers.length 
      : Number((await pool.execute<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as total FROM quarterly_user_statements WHERE batch_id = ?`,
          [batchId]
        ))[0][0]?.total || 0);
    
    const totalPages = Math.ceil(totalAccounts / pageSize);
    const offset = (page - 1) * pageSize;

    // Extract data efficiently
    const activityRows: any[] = [];
    const extractedPreCommitmentPlayers: any[] = [];
    const annotatedPlayers: any[] = [];
    
    if (search) {
      // Use the already-filtered results, just paginate
      const paginatedPlayers = allMatchedPlayers.slice(offset, offset + pageSize);
      annotatedPlayers.push(...paginatedPlayers);
      
      // Add corresponding activity rows for this page
      for (const player of paginatedPlayers) {
        if (player.activity) {
          activityRows.push(player.activity);
        }
      }
      
      // Use extracted preCommitment if we don't have from batch metadata
      if (preCommitmentPlayers.length === 0) {
        extractedPreCommitmentPlayers.push(...allExtractedPreCommitmentPlayers);
      }
    } else {
      // Query quarterly_user_statements with pagination (no search)
      const limitValue = Number(pageSize);
      const offsetValue = Number(offset);
      
      // Validate that limit and offset are valid integers (prevent SQL injection)
      if (!Number.isInteger(limitValue) || !Number.isInteger(offsetValue) || limitValue < 0 || offsetValue < 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid pagination parameters' },
          { status: 400 }
        );
      }
      
      const [rows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT account_number, data
         FROM quarterly_user_statements
         WHERE batch_id = ?
         ORDER BY account_number
         LIMIT ${limitValue} OFFSET ${offsetValue}`,
        [batchId]
      );

      // Process accounts - optimized single pass, only parse JSON once per record
      for (const row of rows) {
        // Decrypt the user data (handles both encrypted and legacy unencrypted data)
        const userData = decryptJson<{
          activity_statement?: any;
          pre_commitment?: any;
          cashless_statement?: any;
        }>(row.data);
        
        // Decrypt account number (handles both encrypted and legacy unencrypted data)
        const account = decrypt(row.account_number || '');
        
        // Build annotated player
        const player = {
          account,
          activity: userData.activity_statement || undefined,
          preCommitment: userData.pre_commitment || undefined,
          cashless: userData.cashless_statement || undefined,
        };
        
        annotatedPlayers.push(player);
        
        if (userData.activity_statement) {
          activityRows.push(userData.activity_statement);
        }
        
        // Only extract preCommitment if we don't have it from batch metadata
        if (preCommitmentPlayers.length === 0 && userData.pre_commitment) {
          extractedPreCommitmentPlayers.push(userData.pre_commitment);
        }
      }
    }

    // Use preCommitmentPlayers from batch metadata if we have it, otherwise use extracted ones
    if (preCommitmentPlayers.length === 0) {
      preCommitmentPlayers = extractedPreCommitmentPlayers;
    }

    // If we still don't have quarterlyData, try to get it from stored records
    // This is needed for batches where quarterlyData wasn't stored in batch metadata
    if (!quarterlyData) {
      // First, try to get from any account in the batch (for old batches that stored it per account)
      // Query one record to check if quarterlyData is stored there
      try {
        const [sampleRow] = await pool.execute<mysql.RowDataPacket[]>(
          `SELECT data FROM quarterly_user_statements WHERE batch_id = ? LIMIT 1`,
          [batchId]
        );
        if (sampleRow.length > 0) {
          // Use decryptJson to handle both encrypted and legacy unencrypted data
          const sampleData = decryptJson<{ quarterlyData?: any }>(sampleRow[0].data);
          if (sampleData.quarterlyData) {
            quarterlyData = sampleData.quarterlyData;
          }
        }
      } catch (error) {
        // Ignore
      }
      
      // If still no quarterlyData, try to reconstruct it from all cashless statements in the batch
      // This is needed for new batches where quarterlyData wasn't stored
      if (!quarterlyData) {
        try {
          // Query all cashless statements to reconstruct quarterlyData
          const [allRows] = await pool.execute<mysql.RowDataPacket[]>(
            `SELECT data FROM quarterly_user_statements WHERE batch_id = ?`,
            [batchId]
          );
          
          const cashlessPlayersMap = new Map<string, any>();
          
          for (const row of allRows) {
            try {
              // Decrypt the user data (handles both encrypted and legacy unencrypted data)
              const userData = decryptJson<{ cashless_statement?: any }>(row.data);
              
              if (userData.cashless_statement) {
                const account = userData.cashless_statement.playerInfo?.playerAccount;
                if (account && !cashlessPlayersMap.has(account)) {
                  cashlessPlayersMap.set(account, userData.cashless_statement);
                }
              }
            } catch (error) {
              // Ignore parsing errors
            }
          }
          
          // Reconstruct quarterlyData from collected cashless players
          if (cashlessPlayersMap.size > 0) {
            const allCashlessPlayers = Array.from(cashlessPlayersMap.values());
            quarterlyData = {
              quarter: batch.quarter,
              year: batch.year,
              players: allCashlessPlayers,
              monthlyBreakdown: [], // We don't have monthly breakdown in stored data, but it's not critical for preview
            };
          }
        } catch (error) {
          console.error('Error reconstructing quarterlyData:', error);
        }
      }
    }

    // Format dates from batch to DD/MM/YYYY format for statementPeriod
    const formatDateToDDMMYYYY = (date: Date | null): string | null => {
      if (!date) return null;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // If batch has start_date and end_date, use them to populate quarterlyData.statementPeriod
    if (batch.start_date && batch.end_date && quarterlyData) {
      const startDateFormatted = formatDateToDDMMYYYY(batch.start_date);
      const endDateFormatted = formatDateToDDMMYYYY(batch.end_date);
      
      if (startDateFormatted && endDateFormatted) {
        quarterlyData = {
          ...quarterlyData,
          statementPeriod: {
            startDate: startDateFormatted,
            endDate: endDateFormatted,
          },
        };
      }
    }

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        quarter: batch.quarter,
        year: batch.year,
        generation_date: batch.generation_date.toISOString(),
        total_accounts: batch.total_accounts,
        start_date: batch.start_date ? batch.start_date.toISOString().split('T')[0] : null,
        end_date: batch.end_date ? batch.end_date.toISOString().split('T')[0] : null,
      },
      annotatedPlayers,
      activityRows,
      preCommitmentPlayers,
      quarterlyData,
      pagination: {
        page,
        pageSize,
        totalAccounts,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error('Error loading batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load batch' },
      { status: 500 }
    );
  }
}


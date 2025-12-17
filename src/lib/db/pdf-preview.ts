import mysql from 'mysql2/promise';
import { pool } from '../db';
import { AnnotatedStatementPlayer, QuarterlyData, PreCommitmentPlayer, ActivityStatementRow } from '@/types/player-data';
import { decrypt, encryptDeterministic, decryptJson } from '../encryption';

// PDF Preview Database Functions
// ============================================

export interface GenerationBatch {
  id: string;
  quarter: number;
  year: number;
  generation_date: Date;
  total_accounts: number;
  start_date: Date | null;
  end_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MatchedAccount {
  id: string;
  batch_id: string;
  account_number: string;
  account_data: AnnotatedStatementPlayer;
  has_activity: boolean;
  has_pre_commitment: boolean;
  has_cashless: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get a batch by ID
 */
export async function getBatchById(batchId: string): Promise<GenerationBatch | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, quarter, year, generation_date, total_accounts, start_date, end_date, created_at, updated_at
       FROM generation_batches
       WHERE id = ?`,
      [batchId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      quarter: row.quarter,
      year: row.year,
      generation_date: new Date(row.generation_date),
      total_accounts: row.total_accounts,
      start_date: row.start_date ? new Date(row.start_date) : null,
      end_date: row.end_date ? new Date(row.end_date) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } catch (error) {
    console.error('Error fetching batch:', error);
    throw error;
  }
}

/**
 * Get all matched accounts for a specific batch
 * Reads from quarterly_user_statements and reconstructs AnnotatedStatementPlayer format
 */
export async function getMatchedAccountsByBatch(batchId: string): Promise<MatchedAccount[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, account_number, data, created_at, updated_at
       FROM quarterly_user_statements
       WHERE batch_id = ?
       ORDER BY account_number`,
      [batchId]
    );

    return rows.map(row => {
      // Decrypt the user data (handles both encrypted and legacy unencrypted data)
      const userData = decryptJson<{
        activity_statement?: ActivityStatementRow;
        pre_commitment?: PreCommitmentPlayer;
        cashless_statement?: any;
        quarterlyData?: QuarterlyData;
      }>(row.data);
      
      // Decrypt account number (handles both encrypted and legacy unencrypted data)
      const decryptedAccountNumber = decrypt(row.account_number || '');
      
      // Reconstruct AnnotatedStatementPlayer format for backward compatibility
      // Use != null to check for both null and undefined, preserving actual data objects
      const accountData: AnnotatedStatementPlayer = {
        account: decryptedAccountNumber,
        activity: userData.activity_statement != null ? userData.activity_statement : undefined,
        preCommitment: userData.pre_commitment != null ? userData.pre_commitment : undefined,
        cashless: userData.cashless_statement != null ? userData.cashless_statement : undefined,
        quarterlyData: userData.quarterlyData,
      };

      return {
        id: row.id,
        batch_id: row.batch_id,
        account_number: decryptedAccountNumber,
        account_data: accountData,
        has_activity: Boolean(userData.activity_statement),
        has_pre_commitment: Boolean(userData.pre_commitment),
        has_cashless: Boolean(userData.cashless_statement),
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      };
    });
  } catch (error) {
    console.error('Error fetching matched accounts:', error);
    throw error;
  }
}

/**
 * Get a specific account from a batch (optimized for preview)
 * Reads from quarterly_user_statements and reconstructs AnnotatedStatementPlayer format
 */
export async function getAccountFromBatch(batchId: string, accountNumber: string): Promise<MatchedAccount | null> {
  try {
    // Encrypt account number for lookup (deterministic encryption allows exact match)
    const encryptedAccountNumber = encryptDeterministic(accountNumber);
    
    // Try encrypted lookup first, then fall back to unencrypted (for legacy data)
    // Order by updated_at DESC first (most recently updated), then created_at DESC (most recently created)
    // This ensures we get the latest record if there are multiple entries
    let [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, account_number, data, created_at, updated_at
       FROM quarterly_user_statements
       WHERE batch_id = ? AND account_number = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [batchId, encryptedAccountNumber]
    );

    // Check if there are multiple records (for debugging)
    if (rows.length > 0) {
      const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM quarterly_user_statements
         WHERE batch_id = ? AND account_number = ?`,
        [batchId, encryptedAccountNumber]
      );
      const totalCount = countRows[0]?.count || 0;
      if (totalCount > 1) {
        console.log(`[getAccountFromBatch] WARNING: Found ${totalCount} records for account ${accountNumber} in batch ${batchId}. Using the latest one (ordered by updated_at DESC).`);
      }
    }

    // If not found with encrypted, try with unencrypted (legacy data support)
    if (rows.length === 0) {
      [rows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id, batch_id, account_number, data, created_at, updated_at
         FROM quarterly_user_statements
         WHERE batch_id = ? AND account_number = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [batchId, accountNumber]
      );
      
      // Check count for unencrypted lookup too
      if (rows.length > 0) {
        const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as count FROM quarterly_user_statements
           WHERE batch_id = ? AND account_number = ?`,
          [batchId, accountNumber]
        );
        const totalCount = countRows[0]?.count || 0;
        if (totalCount > 1) {
          console.log(`[getAccountFromBatch] WARNING: Found ${totalCount} unencrypted records for account ${accountNumber} in batch ${batchId}. Using the latest one (ordered by updated_at DESC).`);
        }
      }
    }

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    
    // Debug: Log raw data before decryption, including timestamps to verify we got the latest
    console.log(`[getAccountFromBatch] Raw data for account lookup (batch ${batchId}):`, {
      accountNumberProvided: accountNumber,
      encryptedAccountNumber: encryptDeterministic(accountNumber),
      rowAccountNumber: row.account_number?.substring(0, 20) + '...',
      dataLength: row.data?.length,
      dataPrefix: row.data?.substring(0, 50),
      recordId: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isLatestRecord: true, // We ordered by updated_at DESC, so this should be the latest
    });
    
    // Decrypt the user data (handles both encrypted and legacy unencrypted data)
    let userData: any;
    try {
      userData = decryptJson<{
        activity_statement?: ActivityStatementRow;
        pre_commitment?: PreCommitmentPlayer;
        cashless_statement?: any;
        quarterlyData?: QuarterlyData;
      }>(row.data);
    } catch (error) {
      console.error(`[getAccountFromBatch] Error decrypting data:`, error);
      // Try parsing as plain JSON if decryption fails
      try {
        userData = JSON.parse(row.data);
      } catch (parseError) {
        console.error(`[getAccountFromBatch] Error parsing as JSON:`, parseError);
        throw error; // Re-throw original decryption error
      }
    }
    
    // Decrypt account number (handles both encrypted and legacy unencrypted data)
    const decryptedAccountNumber = decrypt(row.account_number || '');
    
    // Debug: Log decrypted userData structure
    console.log(`[getAccountFromBatch] Decrypted userData keys:`, Object.keys(userData || {}));
    console.log(`[getAccountFromBatch] Decrypted userData values:`, {
      hasActivityStatement: !!userData?.activity_statement,
      hasPreCommitment: !!userData?.pre_commitment,
      hasCashlessStatement: !!userData?.cashless_statement,
      preCommitmentType: typeof userData?.pre_commitment,
      cashlessStatementType: typeof userData?.cashless_statement,
      preCommitmentValue: userData?.pre_commitment,
      cashlessStatementValue: userData?.cashless_statement,
    });
    
    // Reconstruct AnnotatedStatementPlayer format for backward compatibility
    // Use != null to check for both null and undefined, preserving actual data objects
    const accountData: AnnotatedStatementPlayer = {
      account: decryptedAccountNumber,
      activity: userData?.activity_statement != null ? userData.activity_statement : undefined,
      preCommitment: userData?.pre_commitment != null ? userData.pre_commitment : undefined,
      cashless: userData?.cashless_statement != null ? userData.cashless_statement : undefined,
      quarterlyData: userData?.quarterlyData,
    };
    
    // Debug logging to verify data reconstruction
    console.log(`[getAccountFromBatch] Final accountData for ${decryptedAccountNumber}:`, {
      hasActivity: !!accountData.activity,
      hasPreCommitment: !!accountData.preCommitment,
      hasCashless: !!accountData.cashless,
      preCommitmentKeys: accountData.preCommitment ? Object.keys(accountData.preCommitment) : null,
      cashlessKeys: accountData.cashless ? Object.keys(accountData.cashless) : null,
    });

    return {
      id: row.id,
      batch_id: row.batch_id,
      account_number: decryptedAccountNumber,
      account_data: accountData,
      has_activity: Boolean(userData.activity_statement),
      has_pre_commitment: Boolean(userData.pre_commitment),
      has_cashless: Boolean(userData.cashless_statement),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } catch (error) {
    console.error('Error fetching account from batch:', error);
    throw error;
  }
}

/**
 * Get quarterly data from any account in the batch (for preview)
 * Reads from quarterly_user_statements
 */
export async function getQuarterlyDataFromBatch(batchId: string): Promise<QuarterlyData | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT data
       FROM quarterly_user_statements
       WHERE batch_id = ?
       LIMIT 1`,
      [batchId]
    );

    if (rows.length === 0) {
      return null;
    }

    // Decrypt the user data (handles both encrypted and legacy unencrypted data)
    const userData = decryptJson<{
      quarterlyData?: QuarterlyData;
    }>(rows[0].data);
    return userData?.quarterlyData || null;
  } catch (error) {
    console.error('Error fetching quarterly data from batch:', error);
    throw error;
  }
}

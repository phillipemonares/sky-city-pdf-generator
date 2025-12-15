import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { AnnotatedStatementPlayer, QuarterlyData, PreCommitmentPlayer, ActivityStatementRow, PlayerData } from '@/types/player-data';
import { normalizeAccount } from './pdf-shared';
import { encrypt, decrypt, encryptDeterministic, encryptJson, decryptJson, isEncrypted } from './encryption';

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
  waitForConnections: true,
  connectionLimit: 20, // Increased from 10 to handle concurrent PDF generation
  queueLimit: 0,
  acquireTimeout: 60000, // 60 seconds to acquire connection
  timeout: 60000, // 60 seconds query timeout
  reconnect: true, // Auto-reconnect on connection loss
};

// Create connection pool
export const pool = mysql.createPool(dbConfig);

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
 * Save a generation batch with matched accounts to the database
 * Uses quarterly_user_statements table (one row per user)
 */
export async function saveGenerationBatch(
  quarter: number,
  year: number,
  annotatedPlayers: AnnotatedStatementPlayer[],
  quarterlyData: QuarterlyData,
  startDate?: Date | null,
  endDate?: Date | null
): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Generate UUID for batch
    const batchId = randomUUID();
    const generationDate = new Date();

    // Extract dates from quarterlyData.statementPeriod if not provided
    let startDateValue = startDate;
    let endDateValue = endDate;
    
    if (!startDateValue && quarterlyData.statementPeriod?.startDate) {
      // Parse DD/MM/YYYY format
      const [day, month, yearStr] = quarterlyData.statementPeriod.startDate.split('/');
      if (day && month && yearStr) {
        startDateValue = new Date(parseInt(yearStr), parseInt(month) - 1, parseInt(day));
      }
    }
    
    if (!endDateValue && quarterlyData.statementPeriod?.endDate) {
      // Parse DD/MM/YYYY format
      const [day, month, yearStr] = quarterlyData.statementPeriod.endDate.split('/');
      if (day && month && yearStr) {
        endDateValue = new Date(parseInt(yearStr), parseInt(month) - 1, parseInt(day));
      }
    }

    // Insert generation batch
    try {
      await connection.execute(
        `INSERT INTO generation_batches (id, quarter, year, generation_date, total_accounts, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [batchId, quarter, year, generationDate, annotatedPlayers.length, startDateValue, endDateValue]
      );
    } catch (error: any) {
      // If start_date/end_date columns don't exist, insert without them
      if (error.code === 'ER_BAD_FIELD_ERROR') {
        await connection.execute(
          `INSERT INTO generation_batches (id, quarter, year, generation_date, total_accounts)
           VALUES (?, ?, ?, ?, ?)`,
          [batchId, quarter, year, generationDate, annotatedPlayers.length]
        );
      } else {
        throw error;
      }
    }

    // Insert user statements using batch inserts for performance (23k+ rows)
    // Process in chunks of 1000 to avoid hitting MySQL max_allowed_packet limit
    const chunkSize = 1000;
    const totalPlayers = annotatedPlayers.length;
    
    for (let i = 0; i < totalPlayers; i += chunkSize) {
      const chunk = annotatedPlayers.slice(i, i + chunkSize);
      const values: any[] = [];
      const placeholders: string[] = [];
      
      for (const player of chunk) {
        const statementId = randomUUID();
        
        // Structure data per user: activity_statement, pre_commitment, cashless_statement
        const userData = {
          activity_statement: player.activity || null,
          pre_commitment: player.preCommitment || null,
          cashless_statement: player.cashless || null,
          quarterlyData: quarterlyData, // Include quarterly data for regeneration
        };
        
        // Encrypt the user data JSON for security
        const dataJson = encryptJson(userData);
        
        // Encrypt account number deterministically for lookups
        const encryptedAccountNumber = encryptDeterministic(player.account);
        
        values.push(statementId, batchId, encryptedAccountNumber, dataJson);
        placeholders.push('(?, ?, ?, ?)');
      }
      
      // Execute batch insert
      const sql = `INSERT INTO quarterly_user_statements 
                   (id, batch_id, account_number, data)
                   VALUES ${placeholders.join(', ')}`;
      
      await connection.execute(sql, values);
    }

    await connection.commit();
    return batchId;
  } catch (error) {
    await connection.rollback();
    console.error('Error saving generation batch:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get all generation batches, ordered by most recent first
 */
export async function getAllBatches(): Promise<GenerationBatch[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, quarter, year, generation_date, total_accounts, start_date, end_date, created_at, updated_at
       FROM generation_batches
       ORDER BY generation_date DESC`
    );

    return rows.map(row => ({
      id: row.id,
      quarter: row.quarter,
      year: row.year,
      generation_date: new Date(row.generation_date),
      total_accounts: row.total_accounts,
      start_date: row.start_date ? new Date(row.start_date) : null,
      end_date: row.end_date ? new Date(row.end_date) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error('Error fetching batches:', error);
    throw error;
  }
}

/**
 * Get a specific generation batch by ID
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
      const accountData: AnnotatedStatementPlayer = {
        account: decryptedAccountNumber,
        activity: userData.activity_statement || undefined,
        preCommitment: userData.pre_commitment || undefined,
        cashless: userData.cashless_statement || undefined,
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
    let [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, account_number, data, created_at, updated_at
       FROM quarterly_user_statements
       WHERE batch_id = ? AND account_number = ?
       LIMIT 1`,
      [batchId, encryptedAccountNumber]
    );

    // If not found with encrypted, try with unencrypted (legacy data support)
    if (rows.length === 0) {
      [rows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id, batch_id, account_number, data, created_at, updated_at
         FROM quarterly_user_statements
         WHERE batch_id = ? AND account_number = ?
         LIMIT 1`,
        [batchId, accountNumber]
      );
    }

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
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
    const accountData: AnnotatedStatementPlayer = {
      account: decryptedAccountNumber,
      activity: userData.activity_statement || undefined,
      preCommitment: userData.pre_commitment || undefined,
      cashless: userData.cashless_statement || undefined,
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

/**
 * Update account data in quarterly_user_statements table
 * Preserves existing data fields not being updated
 */
export async function updateAccountData(
  batchId: string,
  accountNumber: string,
  updates: {
    activity_statement?: ActivityStatementRow | null;
    pre_commitment?: PreCommitmentPlayer | null;
    cashless_statement?: PlayerData | null;
    quarterlyData?: QuarterlyData | null;
  }
): Promise<boolean> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Encrypt account number for lookup (deterministic encryption allows exact match)
    const encryptedAccountNumberForLookup = encryptDeterministic(accountNumber);
    
    // Get existing data - try encrypted first, then unencrypted (legacy data support)
    let [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT data, account_number FROM quarterly_user_statements
       WHERE batch_id = ? AND account_number = ?
       LIMIT 1`,
      [batchId, encryptedAccountNumberForLookup]
    );

    // Track which account number format to use for update
    let accountNumberForUpdate = encryptedAccountNumberForLookup;
    
    // If not found with encrypted, try with unencrypted (legacy data support)
    if (rows.length === 0) {
      [rows] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT data, account_number FROM quarterly_user_statements
         WHERE batch_id = ? AND account_number = ?
         LIMIT 1`,
        [batchId, accountNumber]
      );
      if (rows.length > 0) {
        accountNumberForUpdate = accountNumber;
      }
    }

    if (rows.length === 0) {
      throw new Error('Account not found in batch');
    }

    // Decrypt and parse existing data (handles both encrypted and legacy unencrypted data)
    const existingData = decryptJson<{
      activity_statement?: ActivityStatementRow;
      pre_commitment?: PreCommitmentPlayer;
      cashless_statement?: PlayerData;
      quarterlyData?: QuarterlyData;
    }>(rows[0].data);

    // Merge updates with existing data
    const updatedData = {
      activity_statement: updates.activity_statement !== undefined 
        ? updates.activity_statement 
        : existingData.activity_statement || null,
      pre_commitment: updates.pre_commitment !== undefined 
        ? updates.pre_commitment 
        : existingData.pre_commitment || null,
      cashless_statement: updates.cashless_statement !== undefined 
        ? updates.cashless_statement 
        : existingData.cashless_statement || null,
      quarterlyData: updates.quarterlyData !== undefined 
        ? updates.quarterlyData 
        : existingData.quarterlyData || null,
    };

    // Encrypt and update the record
    await connection.execute(
      `UPDATE quarterly_user_statements
       SET data = ?, updated_at = NOW()
       WHERE batch_id = ? AND account_number = ?`,
      [encryptJson(updatedData), batchId, accountNumberForUpdate]
    );

    // If activity_statement was updated, also update the members table
    if (updates.activity_statement !== undefined && updates.activity_statement !== null) {
      const activity = updates.activity_statement;
      const normalizedAccount = normalizeAccount(accountNumber);
      // Encrypt account number deterministically for lookups
      const encryptedAccountNumber = encryptDeterministic(normalizedAccount);
      
      // Check if member exists (search with encrypted account number)
      const [existing] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM members WHERE account_number = ?`,
        [encryptedAccountNumber]
      );
      
      // Convert emailTick and postalTick to boolean (1 or 0)
      const isEmail = activity.emailTick && (activity.emailTick.toLowerCase() === 'yes' || activity.emailTick === '1' || activity.emailTick.toLowerCase() === 'true') ? 1 : 0;
      const isPostal = activity.postalTick && (activity.postalTick.toLowerCase() === 'yes' || activity.postalTick === '1' || activity.postalTick.toLowerCase() === 'true') ? 1 : 0;
      
      // Encrypt sensitive fields
      const encryptedTitle = encrypt(activity.title || '');
      const encryptedFirstName = encrypt(activity.firstName || '');
      const encryptedLastName = encrypt(activity.lastName || '');
      const encryptedEmail = encrypt(activity.email || '');
      const encryptedAddress = encrypt(activity.address || '');
      const encryptedSuburb = encrypt(activity.suburb || '');
      const encryptedState = encrypt(activity.state || '');
      const encryptedPostCode = encrypt(activity.postCode || '');
      
      if (existing.length > 0) {
        // Update existing member
        await connection.execute(
          `UPDATE members 
           SET title = ?, first_name = ?, last_name = ?, email = ?, 
               address = ?, suburb = ?, state = ?, post_code = ?, 
               country = ?, player_type = ?, 
               is_email = COALESCE(?, is_email), 
               is_postal = COALESCE(?, is_postal), 
               updated_at = NOW()
           WHERE account_number = ?`,
          [
            encryptedTitle,
            encryptedFirstName,
            encryptedLastName,
            encryptedEmail,
            encryptedAddress,
            encryptedSuburb,
            encryptedState,
            encryptedPostCode,
            activity.country || '',
            activity.playerType || '',
            isEmail,
            isPostal,
            encryptedAccountNumber
          ]
        );
      } else {
        // Insert new member if it doesn't exist
        const memberId = randomUUID();
        await connection.execute(
          `INSERT INTO members 
           (id, account_number, title, first_name, last_name, email, 
            address, suburb, state, post_code, country, player_type, is_email, is_postal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            memberId,
            encryptedAccountNumber,
            encryptedTitle,
            encryptedFirstName,
            encryptedLastName,
            encryptedEmail,
            encryptedAddress,
            encryptedSuburb,
            encryptedState,
            encryptedPostCode,
            activity.country || '',
            activity.playerType || '',
            isEmail,
            isPostal
          ]
        );
      }
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    console.error('Error updating account data:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Delete a generation batch and all associated matched accounts (cascade)
 */
export async function deleteBatch(batchId: string): Promise<boolean> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    await connection.execute(
      `DELETE FROM generation_batches WHERE id = ?`,
      [batchId]
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting batch:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Close the database connection pool (call on app shutdown)
 */
export async function closePool(): Promise<void> {
  await pool.end();
}

// ============================================
// Play & No-Play Pre-Commitment Batch Functions
// ============================================

export interface NoPlayBatch {
  id: string;
  statement_period: string;
  statement_date: string;
  generation_date: Date;
  total_players: number;
  created_at: Date;
  updated_at: Date;
}

export interface NoPlayPlayer {
  id: string;
  batch_id: string;
  account_number: string;
  player_data: PreCommitmentPlayer;
  statement_period: string;
  statement_date: string;
  no_play_status: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Save a pre-commitment batch with players (both Play and No-Play) to the database
 */
export async function saveNoPlayBatch(
  statementPeriod: string,
  statementDate: string,
  players: PreCommitmentPlayer[]
): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Generate UUID for batch
    const batchId = randomUUID();
    const generationDate = new Date();

    // Insert no-play batch
    await connection.execute(
      `INSERT INTO no_play_batches (id, statement_period, statement_date, generation_date, total_players)
       VALUES (?, ?, ?, ?, ?)`,
      [batchId, statementPeriod, statementDate, generationDate, players.length]
    );

    // Insert no-play players
    for (const player of players) {
      const playerId = randomUUID();
      // Encrypt the player data JSON for security
      const playerDataJson = encryptJson(player);
      // Encrypt account number deterministically for lookups
      const encryptedAccountNumber = encryptDeterministic(player.playerInfo.playerAccount);

      await connection.execute(
        `INSERT INTO no_play_players 
         (id, batch_id, account_number, player_data, statement_period, statement_date, no_play_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          playerId,
          batchId,
          encryptedAccountNumber,
          playerDataJson,
          player.statementPeriod,
          player.statementDate,
          player.noPlayStatus,
        ]
      );
    }

    await connection.commit();
    return batchId;
  } catch (error) {
    await connection.rollback();
    console.error('Error saving no-play batch:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get all no-play batches, ordered by most recent first
 */
export async function getAllNoPlayBatches(): Promise<NoPlayBatch[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, statement_period, statement_date, generation_date, total_players, created_at, updated_at
       FROM no_play_batches
       ORDER BY generation_date DESC`
    );

    return rows.map(row => ({
      id: row.id,
      statement_period: row.statement_period,
      statement_date: row.statement_date,
      generation_date: new Date(row.generation_date),
      total_players: row.total_players,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error('Error fetching no-play batches:', error);
    throw error;
  }
}

/**
 * Get a specific no-play batch by ID
 */
export async function getNoPlayBatchById(batchId: string): Promise<NoPlayBatch | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, statement_period, statement_date, generation_date, total_players, created_at, updated_at
       FROM no_play_batches
       WHERE id = ?`,
      [batchId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      statement_period: row.statement_period,
      statement_date: row.statement_date,
      generation_date: new Date(row.generation_date),
      total_players: row.total_players,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } catch (error) {
    console.error('Error fetching no-play batch:', error);
    throw error;
  }
}

/**
 * Get all no-play players for a specific batch
 */
export async function getNoPlayPlayersByBatch(batchId: string): Promise<NoPlayPlayer[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, account_number, player_data, statement_period, statement_date, no_play_status, created_at, updated_at
       FROM no_play_players
       WHERE batch_id = ?
       ORDER BY account_number`,
      [batchId]
    );

    return rows.map(row => ({
      id: row.id,
      batch_id: row.batch_id,
      // Decrypt account number (handles both encrypted and legacy unencrypted data)
      account_number: decrypt(row.account_number || ''),
      // Decrypt the player data (handles both encrypted and legacy unencrypted data)
      player_data: decryptJson<PreCommitmentPlayer>(row.player_data),
      statement_period: row.statement_period,
      statement_date: row.statement_date,
      no_play_status: row.no_play_status,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error('Error fetching no-play players:', error);
    throw error;
  }
}

/**
 * Delete a no-play batch and all associated players (cascade)
 */
export async function deleteNoPlayBatch(batchId: string): Promise<boolean> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    await connection.execute(
      `DELETE FROM no_play_batches WHERE id = ?`,
      [batchId]
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting no-play batch:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Interface for no-play member with batch info
 */
export interface NoPlayMemberWithBatch {
  account_number: string;
  latest_no_play_batch_id: string;
  latest_no_play_generation_date: Date;
  statement_period: string;
  statement_date: string;
  // Member info extracted from player_data
  first_name: string;
  last_name: string;
  email: string;
  address1: string;
  address2: string;
  suburb: string;
}

/**
 * Interface for play member with batch info (same structure as NoPlayMemberWithBatch)
 */
export interface PlayMemberWithBatch {
  account_number: string;
  latest_play_batch_id: string;
  latest_play_generation_date: Date;
  statement_period: string;
  statement_date: string;
  // Member info extracted from player_data
  first_name: string;
  last_name: string;
  email: string;
  address1: string;
  address2: string;
  suburb: string;
}

/**
 * Get paginated no-play members directly from no-play batches
 * Returns members with their latest no-play batch information
 */
export async function getNoPlayMembersPaginated(
  page: number = 1,
  pageSize: number = 50,
  search: string = ''
): Promise<{ members: NoPlayMemberWithBatch[]; total: number; totalPages: number }> {
  try {
    // Ensure page and pageSize are integers
    const validPage = Math.max(1, Math.floor(page));
    const validPageSize = Math.max(1, Math.floor(pageSize));
    const offset = (validPage - 1) * validPageSize;
    const searchTerm = search.trim().toLowerCase();
    
    // Get all no-play members with their latest batch info (we need all for search)
    const query = `SELECT 
        latest_no_play.account_number,
        latest_no_play.batch_id as latest_no_play_batch_id,
        latest_no_play.generation_date as latest_no_play_generation_date,
        latest_no_play.statement_period,
        latest_no_play.statement_date,
        latest_no_play.player_data
       FROM (
         SELECT 
           npp.account_number,
           npb.id as batch_id,
           npb.generation_date,
           npp.statement_period,
           npp.statement_date,
           npp.player_data,
           ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
         FROM no_play_players npp
         INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
         WHERE npp.no_play_status = 'No Play'
       ) as latest_no_play
       WHERE latest_no_play.rn = 1
       ORDER BY latest_no_play.account_number ASC`;
    
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(query);
    
    const allMembers = rows.map(row => {
      // Decrypt and extract member info from player_data (handles both encrypted and legacy data)
      let playerData: any = {};
      try {
        playerData = decryptJson(row.player_data);
      } catch (error) {
        console.error('Error parsing player_data:', error);
      }
      
      const playerInfo = playerData.playerInfo || {};
      
      return {
        // Decrypt account number (handles both encrypted and legacy unencrypted data)
        account_number: decrypt(row.account_number || ''),
        latest_no_play_batch_id: row.latest_no_play_batch_id,
        latest_no_play_generation_date: new Date(row.latest_no_play_generation_date),
        statement_period: row.statement_period || '',
        statement_date: row.statement_date || '',
        first_name: playerInfo.firstName || '',
        last_name: playerInfo.lastName || '',
        email: playerInfo.email || '',
        address1: playerInfo.address1 || '',
        address2: playerInfo.address2 || '',
        suburb: playerInfo.suburb || '',
      };
    });
    
    // Filter by search term (search on decrypted data)
    let filteredMembers = allMembers;
    if (searchTerm) {
      filteredMembers = allMembers.filter(m => 
        m.account_number?.toLowerCase().includes(searchTerm) ||
        m.first_name?.toLowerCase().includes(searchTerm) ||
        m.last_name?.toLowerCase().includes(searchTerm) ||
        `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes(searchTerm) ||
        m.email?.toLowerCase().includes(searchTerm) ||
        m.address1?.toLowerCase().includes(searchTerm) ||
        m.address2?.toLowerCase().includes(searchTerm) ||
        m.suburb?.toLowerCase().includes(searchTerm)
      );
    }
    
    // Calculate pagination
    const total = filteredMembers.length;
    const totalPages = Math.ceil(total / validPageSize);
    
    // Apply pagination
    const members = filteredMembers.slice(offset, offset + validPageSize);
    
    return {
      members,
      total,
      totalPages
    };
  } catch (error) {
    console.error('Error getting paginated no-play members:', error);
    throw error;
  }
}

/**
 * Get paginated play members directly from no-play batches (filtered by Play status)
 * Returns members with their latest play batch information
 */
export async function getPlayMembersPaginated(
  page: number = 1,
  pageSize: number = 50,
  search: string = ''
): Promise<{ members: PlayMemberWithBatch[]; total: number; totalPages: number }> {
  try {
    // Ensure page and pageSize are integers
    const validPage = Math.max(1, Math.floor(page));
    const validPageSize = Math.max(1, Math.floor(pageSize));
    const offset = (validPage - 1) * validPageSize;
    const searchTerm = search.trim().toLowerCase();
    
    // Get all play members with their latest batch info (we need all for search)
    const query = `SELECT 
        latest_play.account_number,
        latest_play.batch_id as latest_play_batch_id,
        latest_play.generation_date as latest_play_generation_date,
        latest_play.statement_period,
        latest_play.statement_date,
        latest_play.player_data
       FROM (
         SELECT 
           npp.account_number,
           npb.id as batch_id,
           npb.generation_date,
           npp.statement_period,
           npp.statement_date,
           npp.player_data,
           ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
         FROM no_play_players npp
         INNER JOIN no_play_batches npb ON npp.batch_id = npb.id
         WHERE npp.no_play_status = 'Play'
       ) as latest_play
       WHERE latest_play.rn = 1
       ORDER BY latest_play.account_number ASC`;
    
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(query);
    
    const allMembers = rows.map(row => {
      // Decrypt and extract member info from player_data (handles both encrypted and legacy data)
      let playerData: any = {};
      try {
        playerData = decryptJson(row.player_data);
      } catch (error) {
        console.error('Error parsing player_data:', error);
      }
      
      const playerInfo = playerData.playerInfo || {};
      
      return {
        // Decrypt account number (handles both encrypted and legacy unencrypted data)
        account_number: decrypt(row.account_number || ''),
        latest_play_batch_id: row.latest_play_batch_id,
        latest_play_generation_date: new Date(row.latest_play_generation_date),
        statement_period: row.statement_period || '',
        statement_date: row.statement_date || '',
        first_name: playerInfo.firstName || '',
        last_name: playerInfo.lastName || '',
        email: playerInfo.email || '',
        address1: playerInfo.address1 || '',
        address2: playerInfo.address2 || '',
        suburb: playerInfo.suburb || '',
      };
    });
    
    // Filter by search term (search on decrypted data)
    let filteredMembers = allMembers;
    if (searchTerm) {
      filteredMembers = allMembers.filter(m => 
        m.account_number?.toLowerCase().includes(searchTerm) ||
        m.first_name?.toLowerCase().includes(searchTerm) ||
        m.last_name?.toLowerCase().includes(searchTerm) ||
        `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes(searchTerm) ||
        m.email?.toLowerCase().includes(searchTerm) ||
        m.address1?.toLowerCase().includes(searchTerm) ||
        m.address2?.toLowerCase().includes(searchTerm) ||
        m.suburb?.toLowerCase().includes(searchTerm)
      );
    }
    
    // Calculate pagination
    const total = filteredMembers.length;
    const totalPages = Math.ceil(total / validPageSize);
    
    // Apply pagination
    const members = filteredMembers.slice(offset, offset + validPageSize);
    
    return {
      members,
      total,
      totalPages
    };
  } catch (error) {
    console.error('Error getting paginated play members:', error);
    throw error;
  }
}

export interface Member {
  id: string;
  account_number: string;
  title: string;
  first_name: string;
  last_name: string;
  email: string;
  address: string;
  suburb: string;
  state: string;
  post_code: string;
  country: string;
  player_type: string;
  is_email: number;
  is_postal: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Save or update members from activity statement rows
 * Only saves unique members based on account number
 * Returns the count of newly saved members
 */
export async function saveMembersFromActivity(activityRows: ActivityStatementRow[]): Promise<number> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    let savedCount = 0;
    
    for (const row of activityRows) {
      if (!row.acct) continue; // Skip rows without account number
      
      const normalizedAccount = normalizeAccount(row.acct);
      // Encrypt account number deterministically for lookups
      const encryptedAccountNumber = encryptDeterministic(normalizedAccount);
      
      // Check if member already exists (search with encrypted account number)
      const [existing] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM members WHERE account_number = ?`,
        [encryptedAccountNumber]
      );
      
      // Encrypt sensitive fields
      const encryptedTitle = encrypt(row.title || '');
      const encryptedFirstName = encrypt(row.firstName || '');
      const encryptedLastName = encrypt(row.lastName || '');
      const encryptedEmail = encrypt(row.email || '');
      const encryptedAddress = encrypt(row.address || '');
      const encryptedSuburb = encrypt(row.suburb || '');
      const encryptedState = encrypt(row.state || '');
      const encryptedPostCode = encrypt(row.postCode || '');

      if (existing.length > 0) {
        // Update existing member
        await connection.execute(
          `UPDATE members 
           SET title = ?, first_name = ?, last_name = ?, email = ?, 
               address = ?, suburb = ?, state = ?, post_code = ?, 
               country = ?, player_type = ?, is_email = COALESCE(is_email, 0), 
               is_postal = COALESCE(is_postal, 0), updated_at = NOW()
           WHERE account_number = ?`,
          [
            encryptedTitle,
            encryptedFirstName,
            encryptedLastName,
            encryptedEmail,
            encryptedAddress,
            encryptedSuburb,
            encryptedState,
            encryptedPostCode,
            row.country || '',
            row.playerType || '',
            encryptedAccountNumber
          ]
        );
      } else {
        // Insert new member
        const memberId = randomUUID();
        await connection.execute(
          `INSERT INTO members 
           (id, account_number, title, first_name, last_name, email, 
            address, suburb, state, post_code, country, player_type, is_email, is_postal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            memberId,
            encryptedAccountNumber,
            encryptedTitle,
            encryptedFirstName,
            encryptedLastName,
            encryptedEmail,
            encryptedAddress,
            encryptedSuburb,
            encryptedState,
            encryptedPostCode,
            row.country || '',
            row.playerType || '',
            0, // is_email default to 0 for activity statements
            0  // is_postal default to 0 for activity statements
          ]
        );
        savedCount++;
      }
    }
    
    await connection.commit();
    return savedCount;
  } catch (error) {
    await connection.rollback();
    console.error('Error saving members:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get member by account number
 */
export async function getMemberByAccount(accountNumber: string): Promise<Member | null> {
  const connection = await pool.getConnection();
  
  try {
    const normalizedAccount = normalizeAccount(accountNumber);
    // Encrypt account number for lookup (deterministic encryption allows exact match)
    const encryptedAccountNumber = encryptDeterministic(normalizedAccount);
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM members WHERE account_number = ? LIMIT 1`,
      [encryptedAccountNumber]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const memberRow = rows[0];
    // Decrypt sensitive fields (handles both encrypted and legacy unencrypted data)
    return {
      id: memberRow.id,
      account_number: decrypt(memberRow.account_number || ''),
      title: decrypt(memberRow.title || ''),
      first_name: decrypt(memberRow.first_name || ''),
      last_name: decrypt(memberRow.last_name || ''),
      email: decrypt(memberRow.email || ''),
      address: decrypt(memberRow.address || ''),
      suburb: decrypt(memberRow.suburb || ''),
      state: decrypt(memberRow.state || ''),
      post_code: decrypt(memberRow.post_code || ''),
      country: memberRow.country || '',
      player_type: memberRow.player_type || '',
      is_email: memberRow.is_email ?? 0,
      is_postal: memberRow.is_postal ?? 0,
      created_at: memberRow.created_at,
      updated_at: memberRow.updated_at
    };
  } catch (error) {
    console.error('Error getting member:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get all members from the database with pagination
 */
export async function getAllMembers(): Promise<Member[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM members ORDER BY account_number ASC`
    );
    
    // Decrypt sensitive fields for each member (handles both encrypted and legacy data)
    return rows.map(row => ({
      id: row.id,
      account_number: decrypt(row.account_number || ''),
      title: decrypt(row.title || ''),
      first_name: decrypt(row.first_name || ''),
      last_name: decrypt(row.last_name || ''),
      email: decrypt(row.email || ''),
      address: decrypt(row.address || ''),
      suburb: decrypt(row.suburb || ''),
      state: decrypt(row.state || ''),
      post_code: decrypt(row.post_code || ''),
      country: row.country || '',
      player_type: row.player_type || '',
      is_email: row.is_email ?? 0,
      is_postal: row.is_postal ?? 0,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  } catch (error) {
    console.error('Error getting all members:', error);
    throw error;
  }
}

/**
 * Save or update members from Member Contact sheet data
 * Only saves unique members based on account number
 * Returns the count of newly saved members
 */
export async function saveMembersFromMemberContact(
  memberContacts: Array<{
    accountNumber: string;
    firstName: string;
    lastName: string;
    preferredName: string;
    isEmail: number;
    isPostal: number;
    email: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }>
): Promise<number> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    let savedCount = 0;
    
    for (const contact of memberContacts) {
      if (!contact.accountNumber) continue; // Skip rows without account number
      
      const normalizedAccount = normalizeAccount(contact.accountNumber);
      // Encrypt account number deterministically for lookups
      const encryptedAccountNumber = encryptDeterministic(normalizedAccount);
      
      // Use preferredName if available, otherwise firstName
      const displayName = contact.preferredName || contact.firstName;
      
      // Combine address1 and address2
      const fullAddress = [contact.address1, contact.address2].filter(Boolean).join(' ').trim();
      
      // Encrypt sensitive fields
      const encryptedFirstName = encrypt(displayName);
      const encryptedLastName = encrypt(contact.lastName || '');
      const encryptedEmail = encrypt(contact.email || '');
      const encryptedAddress = encrypt(fullAddress);
      const encryptedSuburb = encrypt(contact.city || '');
      const encryptedState = encrypt(contact.state || '');
      const encryptedPostCode = encrypt(contact.postalCode || '');
      
      // Check if member already exists (search with encrypted account number)
      const [existing] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM members WHERE account_number = ?`,
        [encryptedAccountNumber]
      );
      
      if (existing.length > 0) {
        // Update existing member
        await connection.execute(
          `UPDATE members 
           SET first_name = ?, last_name = ?, email = ?, 
               address = ?, suburb = ?, state = ?, post_code = ?, 
               country = ?, is_email = ?, is_postal = ?, updated_at = NOW()
           WHERE account_number = ?`,
          [
            encryptedFirstName,
            encryptedLastName,
            encryptedEmail,
            encryptedAddress,
            encryptedSuburb,
            encryptedState,
            encryptedPostCode,
            contact.country || '',
            contact.isEmail,
            contact.isPostal,
            encryptedAccountNumber
          ]
        );
      } else {
        // Insert new member
        const memberId = randomUUID();
        await connection.execute(
          `INSERT INTO members 
           (id, account_number, title, first_name, last_name, email, 
            address, suburb, state, post_code, country, player_type, is_email, is_postal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            memberId,
            encryptedAccountNumber,
            '', // title not in Member Contact sheet (empty string, not encrypted)
            encryptedFirstName,
            encryptedLastName,
            encryptedEmail,
            encryptedAddress,
            encryptedSuburb,
            encryptedState,
            encryptedPostCode,
            contact.country || '',
            '', // player_type not in Member Contact sheet
            contact.isEmail,
            contact.isPostal
          ]
        );
        savedCount++;
      }
    }
    
    await connection.commit();
    return savedCount;
  } catch (error) {
    await connection.rollback();
    console.error('Error saving members from Member Contact:', error);
    throw error;
  } finally {
    connection.release();
  }
}

export interface MemberWithBatch extends Member {
  latest_batch_id: string | null;
  latest_quarter: number | null;
  latest_year: number | null;
  latest_generation_date: Date | null;
  latest_no_play_batch_id: string | null;
  latest_no_play_generation_date: Date | null;
}

/**
 * Get paginated members from the database with their latest batch information
 * When search is provided, fetches all members, decrypts, filters, then paginates
 * (required because data is encrypted and SQL LIKE cannot search encrypted text)
 * 
 * NOTE: Batch lookup is done in application code after decryption to handle
 * cases where encryption keys might differ between tables or legacy unencrypted data
 */
export async function getMembersPaginated(
  page: number = 1,
  pageSize: number = 50,
  search: string = ''
): Promise<{ members: MemberWithBatch[]; total: number; totalPages: number }> {
  try {
    // Ensure page and pageSize are integers
    const validPage = Math.max(1, Math.floor(page));
    const validPageSize = Math.max(1, Math.floor(pageSize));
    const offset = (validPage - 1) * validPageSize;
    const searchTerm = search.trim().toLowerCase();
    
    // Fetch members separately
    const membersQuery = `SELECT * FROM members ORDER BY account_number ASC`;
    const [memberRows] = await pool.execute<mysql.RowDataPacket[]>(membersQuery);
    
    // Fetch latest quarterly batch per account
    const quarterlyBatchQuery = `
      SELECT 
        qus.account_number,
        gb.id as batch_id,
        gb.quarter,
        gb.year,
        gb.generation_date,
        ROW_NUMBER() OVER (PARTITION BY qus.account_number ORDER BY gb.generation_date DESC) as rn
      FROM quarterly_user_statements qus
      INNER JOIN generation_batches gb ON qus.batch_id = gb.id`;
    const [quarterlyRows] = await pool.execute<mysql.RowDataPacket[]>(quarterlyBatchQuery);
    
    // Build a map of decrypted account -> latest batch info
    const quarterlyBatchMap = new Map<string, { batch_id: string; quarter: number; year: number; generation_date: Date }>();
    for (const row of quarterlyRows) {
      if (row.rn === 1) {
        const decryptedAccount = decrypt(row.account_number || '');
        quarterlyBatchMap.set(decryptedAccount, {
          batch_id: row.batch_id,
          quarter: row.quarter,
          year: row.year,
          generation_date: new Date(row.generation_date)
        });
      }
    }
    
    // Fetch latest no-play batch per account
    const noPlayBatchQuery = `
      SELECT 
        npp.account_number,
        npb.id as batch_id,
        npb.generation_date,
        ROW_NUMBER() OVER (PARTITION BY npp.account_number ORDER BY npb.generation_date DESC) as rn
      FROM no_play_players npp
      INNER JOIN no_play_batches npb ON npp.batch_id = npb.id`;
    const [noPlayRows] = await pool.execute<mysql.RowDataPacket[]>(noPlayBatchQuery);
    
    // Build a map of decrypted account -> latest no-play batch info
    const noPlayBatchMap = new Map<string, { batch_id: string; generation_date: Date }>();
    for (const row of noPlayRows) {
      if (row.rn === 1) {
        const decryptedAccount = decrypt(row.account_number || '');
        noPlayBatchMap.set(decryptedAccount, {
          batch_id: row.batch_id,
          generation_date: new Date(row.generation_date)
        });
      }
    }
    
    // Decrypt sensitive fields for each member and match with batch info
    const allMembers = memberRows.map(row => {
      const decryptedAccountNumber = decrypt(row.account_number || '');
      const quarterlyBatch = quarterlyBatchMap.get(decryptedAccountNumber);
      const noPlayBatch = noPlayBatchMap.get(decryptedAccountNumber);
      
      return {
        id: row.id,
        account_number: decryptedAccountNumber,
        title: decrypt(row.title || ''),
        first_name: decrypt(row.first_name || ''),
        last_name: decrypt(row.last_name || ''),
        email: decrypt(row.email || ''),
        address: decrypt(row.address || ''),
        suburb: decrypt(row.suburb || ''),
        state: decrypt(row.state || ''),
        post_code: decrypt(row.post_code || ''),
        country: row.country || '',
        player_type: row.player_type || '',
        is_email: row.is_email ?? 0,
        is_postal: row.is_postal ?? 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
        latest_batch_id: quarterlyBatch?.batch_id || null,
        latest_quarter: quarterlyBatch?.quarter || null,
        latest_year: quarterlyBatch?.year || null,
        latest_generation_date: quarterlyBatch?.generation_date || null,
        latest_no_play_batch_id: noPlayBatch?.batch_id || null,
        latest_no_play_generation_date: noPlayBatch?.generation_date || null,
      };
    });
    
    // Filter by search term (search on decrypted data)
    let filteredMembers = allMembers;
    if (searchTerm) {
      filteredMembers = allMembers.filter(m => 
        m.account_number?.toLowerCase().includes(searchTerm) ||
        m.title?.toLowerCase().includes(searchTerm) ||
        m.first_name?.toLowerCase().includes(searchTerm) ||
        m.last_name?.toLowerCase().includes(searchTerm) ||
        `${m.title || ''} ${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes(searchTerm) ||
        m.email?.toLowerCase().includes(searchTerm) ||
        m.address?.toLowerCase().includes(searchTerm) ||
        m.suburb?.toLowerCase().includes(searchTerm) ||
        m.state?.toLowerCase().includes(searchTerm) ||
        m.post_code?.toLowerCase().includes(searchTerm)
      );
    }
    
    // Calculate pagination
    const total = filteredMembers.length;
    const totalPages = Math.ceil(total / validPageSize);
    
    // Apply pagination
    const members = filteredMembers.slice(offset, offset + validPageSize);
    
    return {
      members,
      total,
      totalPages
    };
  } catch (error) {
    console.error('Error getting paginated members:', error);
    throw error;
  }
}

/**
 * Delete members by their IDs
 */
export async function deleteMembers(memberIds: string[]): Promise<number> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    if (memberIds.length === 0) {
      await connection.commit();
      return 0;
    }
    
    // Delete members by IDs
    const placeholders = memberIds.map(() => '?').join(',');
    const [result] = await connection.execute<mysql.ResultSetHeader>(
      `DELETE FROM members WHERE id IN (${placeholders})`,
      memberIds
    );
    
    await connection.commit();
    return result.affectedRows;
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting members:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// ============================================
// User Authentication Functions
// ============================================

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'team_member';
  totp_secret?: string | null;
  totp_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get user by username
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, username, password_hash, role, totp_secret, totp_enabled, created_at, updated_at
       FROM users
       WHERE username = ?`,
      [username]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      username: row.username,
      password_hash: row.password_hash,
      role: (row.role || 'team_member') as 'admin' | 'team_member',
      totp_secret: row.totp_secret || null,
      totp_enabled: Boolean(row.totp_enabled),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } catch (error) {
    console.error('Error getting user by username:', error);
    throw error;
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, username, password_hash, role, totp_secret, totp_enabled, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      username: row.username,
      password_hash: row.password_hash,
      role: (row.role || 'team_member') as 'admin' | 'team_member',
      totp_secret: row.totp_secret || null,
      totp_enabled: Boolean(row.totp_enabled),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } catch (error) {
    console.error('Error getting user by ID:', error);
    throw error;
  }
}

/**
 * Create a new user (for admin use only - no registration endpoint)
 */
export async function createUser(username: string, passwordHash: string, role: 'admin' | 'team_member' = 'team_member'): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Check if user already exists
    const existing = await getUserByUsername(username);
    if (existing) {
      throw new Error('User already exists');
    }

    // Generate UUID for user
    const userId = randomUUID();

    // Insert user
    await connection.execute(
      `INSERT INTO users (id, username, password_hash, role)
       VALUES (?, ?, ?, ?)`,
      [userId, username, passwordHash, role]
    );

    await connection.commit();
    return userId;
  } catch (error) {
    await connection.rollback();
    console.error('Error creating user:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get all users
 */
export async function getAllUsers(): Promise<Omit<User, 'password_hash'>[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, username, role, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    return rows.map(row => ({
      id: row.id,
      username: row.username,
      role: (row.role || 'team_member') as 'admin' | 'team_member',
      totp_secret: null,
      totp_enabled: false,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error('Error getting all users:', error);
    throw error;
  }
}

/**
 * Update user information (email/username, password, role)
 */
export async function updateUser(
  userId: string,
  updates: {
    username?: string;
    passwordHash?: string;
    role?: 'admin' | 'team_member';
  }
): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Check if user exists
    const existing = await getUserById(userId);
    if (!existing) {
      throw new Error('User not found');
    }

    // If username is being updated, check if new username already exists
    if (updates.username && updates.username !== existing.username) {
      const userWithNewUsername = await getUserByUsername(updates.username);
      if (userWithNewUsername) {
        throw new Error('A user with this username already exists');
      }
    }

    // Build update query dynamically based on what's being updated
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.username) {
      updateFields.push('username = ?');
      updateValues.push(updates.username);
    }

    if (updates.passwordHash) {
      updateFields.push('password_hash = ?');
      updateValues.push(updates.passwordHash);
    }

    if (updates.role !== undefined) {
      updateFields.push('role = ?');
      updateValues.push(updates.role);
    }

    if (updateFields.length === 0) {
      await connection.rollback();
      return; // Nothing to update
    }

    // Always update the updated_at timestamp
    updateFields.push('updated_at = NOW()');
    updateValues.push(userId);

    await connection.execute(
      `UPDATE users 
       SET ${updateFields.join(', ')}
       WHERE id = ?`,
      updateValues
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error('Error updating user:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Delete a user by ID
 */
export async function deleteUser(userId: string): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Delete user's sessions first
    await connection.execute(
      `DELETE FROM sessions WHERE username IN (SELECT username FROM users WHERE id = ?)`,
      [userId]
    );

    // Delete user
    await connection.execute(
      `DELETE FROM users WHERE id = ?`,
      [userId]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting user:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Update user's TOTP secret and enable 2FA
 */
export async function updateUserTotpSecret(username: string, secret: string): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE users 
       SET totp_secret = ?, totp_enabled = TRUE, updated_at = NOW()
       WHERE username = ?`,
      [secret, username]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error('Error updating user TOTP secret:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Disable TOTP for a user (clear secret and disable flag)
 */
export async function disableUserTotp(username: string): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE users 
       SET totp_secret = NULL, totp_enabled = FALSE, updated_at = NOW()
       WHERE username = ?`,
      [username]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error('Error disabling user TOTP:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// ============================================
// Session Management Functions
// ============================================

export interface Session {
  token: string;
  username: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Create a session in the database
 */
export async function createSession(token: string, username: string, expiresAt: Date): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO sessions (token, username, expires_at)
       VALUES (?, ?, ?)`,
      [token, username, expiresAt]
    );
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

/**
 * Get session by token
 */
export async function getSessionByToken(token: string): Promise<Session | null> {
  try {
    // First, clean up expired sessions
    await pool.execute(
      `DELETE FROM sessions WHERE expires_at < NOW()`
    );

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT token, username, expires_at, created_at
       FROM sessions
       WHERE token = ? AND expires_at > NOW()`,
      [token]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      token: row.token,
      username: row.username,
      expires_at: new Date(row.expires_at),
      created_at: new Date(row.created_at),
    };
  } catch (error) {
    console.error('Error getting session:', error);
    throw error;
  }
}

/**
 * Delete a session by token
 */
export async function deleteSession(token: string): Promise<void> {
  try {
    await pool.execute(
      `DELETE FROM sessions WHERE token = ?`,
      [token]
    );
  } catch (error) {
    console.error('Error deleting session:', error);
    throw error;
  }
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(username: string): Promise<void> {
  try {
    await pool.execute(
      `DELETE FROM sessions WHERE username = ?`,
      [username]
    );
  } catch (error) {
    console.error('Error deleting user sessions:', error);
    throw error;
  }
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    await pool.execute(
      `DELETE FROM sessions WHERE expires_at < NOW()`
    );
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
    throw error;
  }
}

// ============================================
// PDF Export Job Tracking Functions
// ============================================

export interface PdfExport {
  id: string;
  tab_type: 'quarterly' | 'play' | 'no-play';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_members: number;
  processed_members: number;
  failed_members: number;
  file_path: string | null;
  file_size: number | null;
  error_message: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/**
 * Create a new PDF export job
 */
export async function createPdfExport(
  tabType: 'quarterly' | 'play' | 'no-play',
  totalMembers: number,
  createdBy?: string
): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const exportId = randomUUID();

    await connection.execute(
      `INSERT INTO pdf_exports (id, tab_type, status, total_members, created_by)
       VALUES (?, ?, 'pending', ?, ?)`,
      [exportId, tabType, totalMembers, createdBy || null]
    );

    await connection.commit();
    return exportId;
  } catch (error) {
    await connection.rollback();
    console.error('Error creating PDF export:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get PDF export by ID
 */
export async function getPdfExport(exportId: string): Promise<PdfExport | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM pdf_exports WHERE id = ?`,
      [exportId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      tab_type: row.tab_type,
      status: row.status,
      total_members: row.total_members,
      processed_members: row.processed_members || 0,
      failed_members: row.failed_members || 0,
      file_path: row.file_path || null,
      file_size: row.file_size || null,
      error_message: row.error_message || null,
      created_by: row.created_by || null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      started_at: row.started_at ? new Date(row.started_at) : null,
      completed_at: row.completed_at ? new Date(row.completed_at) : null,
    };
  } catch (error) {
    console.error('Error getting PDF export:', error);
    throw error;
  }
}

/**
 * Update PDF export status
 */
export async function updatePdfExportStatus(
  exportId: string,
  updates: {
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    processed_members?: number;
    failed_members?: number;
    file_path?: string | null;
    file_size?: number | null;
    error_message?: string | null;
    started_at?: Date | null;
    completed_at?: Date | null;
  }
): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(updates.status);
      
      // Set started_at when status changes to processing
      if (updates.status === 'processing' && !updates.started_at) {
        updateFields.push('started_at = NOW()');
      }
      
      // Set completed_at when status changes to completed or failed
      if ((updates.status === 'completed' || updates.status === 'failed') && !updates.completed_at) {
        updateFields.push('completed_at = NOW()');
      }
    }

    if (updates.processed_members !== undefined) {
      updateFields.push('processed_members = ?');
      updateValues.push(updates.processed_members);
    }

    if (updates.failed_members !== undefined) {
      updateFields.push('failed_members = ?');
      updateValues.push(updates.failed_members);
    }

    if (updates.file_path !== undefined) {
      updateFields.push('file_path = ?');
      updateValues.push(updates.file_path);
    }

    if (updates.file_size !== undefined) {
      updateFields.push('file_size = ?');
      updateValues.push(updates.file_size);
    }

    if (updates.error_message !== undefined) {
      updateFields.push('error_message = ?');
      updateValues.push(updates.error_message);
    }

    if (updates.started_at !== undefined) {
      updateFields.push('started_at = ?');
      updateValues.push(updates.started_at);
    }

    if (updates.completed_at !== undefined) {
      updateFields.push('completed_at = ?');
      updateValues.push(updates.completed_at);
    }

    if (updateFields.length === 0) {
      await connection.commit();
      return;
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(exportId);

    await connection.execute(
      `UPDATE pdf_exports SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error('Error updating PDF export status:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get all PDF exports ordered by most recent first
 */
export async function getAllPdfExports(limit: number = 50): Promise<PdfExport[]> {
  try {
    // LIMIT must be a literal integer, not a parameter
    const limitValue = Math.max(1, Math.floor(limit));
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM pdf_exports ORDER BY created_at DESC LIMIT ${limitValue}`
    );

    return rows.map(row => ({
      id: row.id,
      tab_type: row.tab_type,
      status: row.status,
      total_members: row.total_members,
      processed_members: row.processed_members || 0,
      failed_members: row.failed_members || 0,
      file_path: row.file_path || null,
      file_size: row.file_size || null,
      error_message: row.error_message || null,
      created_by: row.created_by || null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      started_at: row.started_at ? new Date(row.started_at) : null,
      completed_at: row.completed_at ? new Date(row.completed_at) : null,
    }));
  } catch (error) {
    console.error('Error getting all PDF exports:', error);
    throw error;
  }
}


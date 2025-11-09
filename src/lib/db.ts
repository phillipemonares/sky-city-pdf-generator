import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { AnnotatedStatementPlayer, QuarterlyData, PreCommitmentPlayer, ActivityStatementRow } from '@/types/player-data';
import { normalizeAccount } from './pdf-shared';

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

export interface GenerationBatch {
  id: string;
  quarter: number;
  year: number;
  generation_date: Date;
  total_accounts: number;
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
 */
export async function saveGenerationBatch(
  quarter: number,
  year: number,
  annotatedPlayers: AnnotatedStatementPlayer[],
  quarterlyData: QuarterlyData
): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Generate UUID for batch
    const batchId = randomUUID();
    const generationDate = new Date();

    // Insert generation batch
    await connection.execute(
      `INSERT INTO generation_batches (id, quarter, year, generation_date, total_accounts)
       VALUES (?, ?, ?, ?, ?)`,
      [batchId, quarter, year, generationDate, annotatedPlayers.length]
    );

    // Insert matched accounts
    for (const player of annotatedPlayers) {
      const accountId = randomUUID();
      const accountDataJson = JSON.stringify({
        ...player,
        quarterlyData: quarterlyData, // Include quarterly data for regeneration
      });

      await connection.execute(
        `INSERT INTO matched_accounts 
         (id, batch_id, account_number, account_data, has_activity, has_pre_commitment, has_cashless)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          batchId,
          player.account,
          accountDataJson,
          Boolean(player.activity),
          Boolean(player.preCommitment),
          Boolean(player.cashless),
        ]
      );
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
      `SELECT id, quarter, year, generation_date, total_accounts, created_at, updated_at
       FROM generation_batches
       ORDER BY generation_date DESC`
    );

    return rows.map(row => ({
      id: row.id,
      quarter: row.quarter,
      year: row.year,
      generation_date: new Date(row.generation_date),
      total_accounts: row.total_accounts,
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
      `SELECT id, quarter, year, generation_date, total_accounts, created_at, updated_at
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
 */
export async function getMatchedAccountsByBatch(batchId: string): Promise<MatchedAccount[]> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, account_number, account_data, has_activity, 
              has_pre_commitment, has_cashless, created_at, updated_at
       FROM matched_accounts
       WHERE batch_id = ?
       ORDER BY account_number`,
      [batchId]
    );

    return rows.map(row => ({
      id: row.id,
      batch_id: row.batch_id,
      account_number: row.account_number,
      account_data: JSON.parse(row.account_data) as AnnotatedStatementPlayer,
      has_activity: Boolean(row.has_activity),
      has_pre_commitment: Boolean(row.has_pre_commitment),
      has_cashless: Boolean(row.has_cashless),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error('Error fetching matched accounts:', error);
    throw error;
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
// No-Play Pre-Commitment Batch Functions
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
 * Save a no-play pre-commitment batch with players to the database
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
      const playerDataJson = JSON.stringify(player);

      await connection.execute(
        `INSERT INTO no_play_players 
         (id, batch_id, account_number, player_data, statement_period, statement_date, no_play_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          playerId,
          batchId,
          player.playerInfo.playerAccount,
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
      account_number: row.account_number,
      player_data: JSON.parse(row.player_data) as PreCommitmentPlayer,
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
      
      // Check if member already exists
      const [existing] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM members WHERE account_number = ?`,
        [normalizedAccount]
      );
      
      if (existing.length > 0) {
        // Update existing member
        await connection.execute(
          `UPDATE members 
           SET title = ?, first_name = ?, last_name = ?, email = ?, 
               address = ?, suburb = ?, state = ?, post_code = ?, 
               country = ?, player_type = ?, updated_at = NOW()
           WHERE account_number = ?`,
          [
            row.title || '',
            row.firstName || '',
            row.lastName || '',
            row.email || '',
            row.address || '',
            row.suburb || '',
            row.state || '',
            row.postCode || '',
            row.country || '',
            row.playerType || '',
            normalizedAccount
          ]
        );
      } else {
        // Insert new member
        const memberId = randomUUID();
        await connection.execute(
          `INSERT INTO members 
           (id, account_number, title, first_name, last_name, email, 
            address, suburb, state, post_code, country, player_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            memberId,
            normalizedAccount,
            row.title || '',
            row.firstName || '',
            row.lastName || '',
            row.email || '',
            row.address || '',
            row.suburb || '',
            row.state || '',
            row.postCode || '',
            row.country || '',
            row.playerType || ''
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
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM members WHERE account_number = ? LIMIT 1`,
      [normalizedAccount]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const memberRow = rows[0];
    return {
      id: memberRow.id,
      account_number: memberRow.account_number,
      title: memberRow.title || '',
      first_name: memberRow.first_name || '',
      last_name: memberRow.last_name || '',
      email: memberRow.email || '',
      address: memberRow.address || '',
      suburb: memberRow.suburb || '',
      state: memberRow.state || '',
      post_code: memberRow.post_code || '',
      country: memberRow.country || '',
      player_type: memberRow.player_type || '',
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
    
    return rows.map(row => ({
      id: row.id,
      account_number: row.account_number,
      title: row.title || '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      email: row.email || '',
      address: row.address || '',
      suburb: row.suburb || '',
      state: row.state || '',
      post_code: row.post_code || '',
      country: row.country || '',
      player_type: row.player_type || '',
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  } catch (error) {
    console.error('Error getting all members:', error);
    throw error;
  }
}

/**
 * Get paginated members from the database
 */
export async function getMembersPaginated(
  page: number = 1,
  pageSize: number = 50
): Promise<{ members: Member[]; total: number; totalPages: number }> {
  try {
    // Ensure page and pageSize are integers
    const validPage = Math.max(1, Math.floor(page));
    const validPageSize = Math.max(1, Math.floor(pageSize));
    const offset = (validPage - 1) * validPageSize;
    
    // Get total count
    const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM members`
    );
    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / validPageSize);
    
    // Get paginated members - MySQL requires LIMIT and OFFSET to be integers (not placeholders)
    // Since we've validated and converted to integers, it's safe to use template literals
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM members ORDER BY account_number ASC LIMIT ${validPageSize} OFFSET ${offset}`
    );
    
    const members = rows.map(row => ({
      id: row.id,
      account_number: row.account_number,
      title: row.title || '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      email: row.email || '',
      address: row.address || '',
      suburb: row.suburb || '',
      state: row.state || '',
      post_code: row.post_code || '',
      country: row.country || '',
      player_type: row.player_type || '',
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    
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


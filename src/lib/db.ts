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
 * Get a specific account from a batch (optimized for preview)
 */
export async function getAccountFromBatch(batchId: string, accountNumber: string): Promise<MatchedAccount | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, batch_id, account_number, account_data, has_activity, 
              has_pre_commitment, has_cashless, created_at, updated_at
       FROM matched_accounts
       WHERE batch_id = ? AND account_number = ?
       LIMIT 1`,
      [batchId, accountNumber]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      batch_id: row.batch_id,
      account_number: row.account_number,
      account_data: JSON.parse(row.account_data) as AnnotatedStatementPlayer,
      has_activity: Boolean(row.has_activity),
      has_pre_commitment: Boolean(row.has_pre_commitment),
      has_cashless: Boolean(row.has_cashless),
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
 */
export async function getQuarterlyDataFromBatch(batchId: string): Promise<QuarterlyData | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT account_data
       FROM matched_accounts
       WHERE batch_id = ?
       LIMIT 1`,
      [batchId]
    );

    if (rows.length === 0) {
      return null;
    }

    const accountData = JSON.parse(rows[0].account_data) as any;
    return accountData?.quarterlyData || null;
  } catch (error) {
    console.error('Error fetching quarterly data from batch:', error);
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
               country = ?, player_type = ?, is_email = COALESCE(is_email, 0), 
               is_postal = COALESCE(is_postal, 0), updated_at = NOW()
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
            address, suburb, state, post_code, country, player_type, is_email, is_postal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      
      // Use preferredName if available, otherwise firstName
      const displayName = contact.preferredName || contact.firstName;
      
      // Combine address1 and address2
      const fullAddress = [contact.address1, contact.address2].filter(Boolean).join(' ').trim();
      
      // Check if member already exists
      const [existing] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM members WHERE account_number = ?`,
        [normalizedAccount]
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
            displayName,
            contact.lastName || '',
            contact.email || '',
            fullAddress,
            contact.city || '',
            contact.state || '',
            contact.postalCode || '',
            contact.country || '',
            contact.isEmail,
            contact.isPostal,
            normalizedAccount
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
            normalizedAccount,
            '', // title not in Member Contact sheet
            displayName,
            contact.lastName || '',
            contact.email || '',
            fullAddress,
            contact.city || '',
            contact.state || '',
            contact.postalCode || '',
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
}

/**
 * Get paginated members from the database with their latest batch information
 */
export async function getMembersPaginated(
  page: number = 1,
  pageSize: number = 50
): Promise<{ members: MemberWithBatch[]; total: number; totalPages: number }> {
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
    
    // Get paginated members with their latest batch info
    // Join with matched_accounts and generation_batches to get the most recent batch per member
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT 
        m.*,
        latest_batch.batch_id as latest_batch_id,
        latest_batch.quarter as latest_quarter,
        latest_batch.year as latest_year,
        latest_batch.generation_date as latest_generation_date
       FROM members m
       LEFT JOIN (
         SELECT 
           ma.account_number,
           gb.id as batch_id,
           gb.quarter,
           gb.year,
           gb.generation_date,
           ROW_NUMBER() OVER (PARTITION BY ma.account_number ORDER BY gb.generation_date DESC) as rn
         FROM matched_accounts ma
         INNER JOIN generation_batches gb ON ma.batch_id = gb.id
       ) as latest_batch ON m.account_number = latest_batch.account_number AND latest_batch.rn = 1
       ORDER BY m.account_number ASC 
       LIMIT ${validPageSize} OFFSET ${offset}`
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
      is_email: row.is_email ?? 0,
      is_postal: row.is_postal ?? 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
      latest_batch_id: row.latest_batch_id || null,
      latest_quarter: row.latest_quarter || null,
      latest_year: row.latest_year || null,
      latest_generation_date: row.latest_generation_date ? new Date(row.latest_generation_date) : null,
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
  created_at: Date;
  updated_at: Date;
}

/**
 * Get user by username
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, username, password_hash, created_at, updated_at
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
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } catch (error) {
    console.error('Error getting user by username:', error);
    throw error;
  }
}

/**
 * Create a new user (for admin use only - no registration endpoint)
 */
export async function createUser(username: string, passwordHash: string): Promise<string> {
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
      `INSERT INTO users (id, username, password_hash)
       VALUES (?, ?, ?)`,
      [userId, username, passwordHash]
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
      `SELECT id, username, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    return rows.map(row => ({
      id: row.id,
      username: row.username,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error('Error getting all users:', error);
    throw error;
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


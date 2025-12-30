/**
 * Migration script to encrypt existing unencrypted data in the database
 * 
 * This script will:
 * 1. Encrypt sensitive fields in the members table
 * 2. Encrypt the data JSON column in quarterly_user_statements table
 * 3. Encrypt the player_data JSON column in no_play_players table
 * 
 * The script is safe to run multiple times - it skips already encrypted data.
 * 
 * Usage:
 *   ENCRYPTION_KEY=your_64_char_hex_key node scripts/encrypt-existing-data.js
 * 
 * Or if ENCRYPTION_KEY is in .env:
 *   node scripts/encrypt-existing-data.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// Get encryption key
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes / 256 bits)');
  }
  return Buffer.from(key, 'hex');
}

// Encrypt a string
function encrypt(text) {
  if (!text) return text;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: ENC:iv:authTag:encryptedData
  return `ENC:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// Encrypt a JSON object
function encryptJson(obj) {
  if (!obj) return obj;
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString);
}

// Check if data is already encrypted
function isEncrypted(text) {
  return text?.startsWith('ENC:') || false;
}

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
};

async function migrateMembers(connection) {
  console.log('\n=== Migrating members table ===');
  
  // Get all members
  const [members] = await connection.execute('SELECT id, first_name, last_name, email, address, suburb, post_code FROM members');
  console.log(`Found ${members.length} members to check`);
  
  let encrypted = 0;
  let skipped = 0;
  
  for (const member of members) {
    const updates = [];
    const values = [];
    
    // Check and encrypt each field if not already encrypted
    if (member.first_name && !isEncrypted(member.first_name)) {
      updates.push('first_name = ?');
      values.push(encrypt(member.first_name));
    }
    
    if (member.last_name && !isEncrypted(member.last_name)) {
      updates.push('last_name = ?');
      values.push(encrypt(member.last_name));
    }
    
    if (member.email && !isEncrypted(member.email)) {
      updates.push('email = ?');
      values.push(encrypt(member.email));
    }
    
    if (member.address && !isEncrypted(member.address)) {
      updates.push('address = ?');
      values.push(encrypt(member.address));
    }
    
    if (member.suburb && !isEncrypted(member.suburb)) {
      updates.push('suburb = ?');
      values.push(encrypt(member.suburb));
    }
    
    if (member.post_code && !isEncrypted(member.post_code)) {
      updates.push('post_code = ?');
      values.push(encrypt(member.post_code));
    }
    
    if (updates.length > 0) {
      values.push(member.id);
      await connection.execute(
        `UPDATE members SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
      encrypted++;
      
      if (encrypted % 1000 === 0) {
        console.log(`  Encrypted ${encrypted} members...`);
      }
    } else {
      skipped++;
    }
  }
  
  console.log(`Members: ${encrypted} encrypted, ${skipped} already encrypted/empty`);
}

async function migrateQuarterlyUserStatements(connection) {
  console.log('\n=== Migrating quarterly_user_statements table ===');
  
  // Get all statements
  const [statements] = await connection.execute('SELECT id, data FROM quarterly_user_statements');
  console.log(`Found ${statements.length} statements to check`);
  
  let encrypted = 0;
  let skipped = 0;
  
  for (const statement of statements) {
    // Check if data is already encrypted
    if (statement.data && !isEncrypted(statement.data)) {
      try {
        // Parse existing JSON data
        const jsonData = JSON.parse(statement.data);
        // Encrypt the JSON
        const encryptedData = encryptJson(jsonData);
        
        await connection.execute(
          'UPDATE quarterly_user_statements SET data = ? WHERE id = ?',
          [encryptedData, statement.id]
        );
        encrypted++;
        
        if (encrypted % 1000 === 0) {
          console.log(`  Encrypted ${encrypted} statements...`);
        }
      } catch (error) {
        console.error(`  Error encrypting statement ${statement.id}:`, error.message);
      }
    } else {
      skipped++;
    }
  }
  
  console.log(`Quarterly statements: ${encrypted} encrypted, ${skipped} already encrypted/empty`);
}

async function migrateNoPlayPlayers(connection) {
  console.log('\n=== Migrating no_play_players table ===');
  
  // Get all players
  const [players] = await connection.execute('SELECT id, player_data FROM no_play_players');
  console.log(`Found ${players.length} players to check`);
  
  let encrypted = 0;
  let skipped = 0;
  
  for (const player of players) {
    // Check if player_data is already encrypted
    if (player.player_data && !isEncrypted(player.player_data)) {
      try {
        // Parse existing JSON data
        const jsonData = JSON.parse(player.player_data);
        // Encrypt the JSON
        const encryptedData = encryptJson(jsonData);
        
        await connection.execute(
          'UPDATE no_play_players SET player_data = ? WHERE id = ?',
          [encryptedData, player.id]
        );
        encrypted++;
        
        if (encrypted % 1000 === 0) {
          console.log(`  Encrypted ${encrypted} players...`);
        }
      } catch (error) {
        console.error(`  Error encrypting player ${player.id}:`, error.message);
      }
    } else {
      skipped++;
    }
  }
  
  console.log(`No-play players: ${encrypted} encrypted, ${skipped} already encrypted/empty`);
}

async function main() {
  console.log('===========================================');
  console.log('  Data Encryption Migration Script');
  console.log('===========================================');
  
  // Validate encryption key
  try {
    getEncryptionKey();
    console.log('✓ Encryption key validated');
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
  
  // Connect to database
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ Connected to database');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error.message);
    process.exit(1);
  }
  
  try {
    // Start transaction
    await connection.beginTransaction();
    console.log('✓ Transaction started');
    
    // Migrate each table
    await migrateMembers(connection);
    await migrateQuarterlyUserStatements(connection);
    await migrateNoPlayPlayers(connection);
    
    // Commit transaction
    await connection.commit();
    console.log('\n✓ Migration completed successfully!');
    console.log('  All data has been encrypted.');
    
  } catch (error) {
    // Rollback on error
    await connection.rollback();
    console.error('\n✗ Migration failed, rolled back:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run migration
main().catch(console.error);









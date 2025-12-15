/**
 * Migration script to encrypt additional fields in the database
 * 
 * This script encrypts:
 * - members table: account_number (DENC), title (ENC), state (ENC)
 * - quarterly_user_statements table: account_number (DENC)
 * - no_play_players table: account_number (DENC)
 * 
 * The script is safe to run multiple times - it skips already encrypted data.
 * 
 * Usage:
 *   ENCRYPTION_KEY=your_64_char_hex_key node scripts/migrate-encrypt-fields.js
 * 
 * Or if ENCRYPTION_KEY is in .env:
 *   node scripts/migrate-encrypt-fields.js
 * 
 * IMPORTANT: Backup your database before running this script!
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

// Standard encryption (random IV)
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

// Deterministic encryption (HMAC-derived IV)
function encryptDeterministic(text) {
  if (!text) return text;
  
  const key = getEncryptionKey();
  
  // Derive IV from HMAC of the text (deterministic)
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(text);
  const iv = hmac.digest().subarray(0, IV_LENGTH);
  
  // Encrypt with derived IV
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  // Format: DENC:iv:authTag:encryptedData
  return `DENC:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// Check if data is already encrypted (ENC: or DENC:)
function isEncrypted(text) {
  return text?.startsWith('ENC:') || text?.startsWith('DENC:') || false;
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

const BATCH_SIZE = 1000;

async function migrateMembers(connection) {
  console.log('\n=== Migrating members table (account_number, title, state) ===');
  
  // Get count
  const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM members');
  const totalCount = countResult[0].count;
  console.log(`Found ${totalCount} members to check`);
  
  let processed = 0;
  let encrypted = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process in batches
  while (processed < totalCount) {
    // Note: LIMIT/OFFSET don't work well as placeholders in MySQL prepared statements
    const [members] = await connection.query(
      `SELECT id, account_number, title, state FROM members LIMIT ${BATCH_SIZE} OFFSET ${processed}`
    );
    
    if (members.length === 0) break;
    
    for (const member of members) {
      try {
        const updates = [];
        const values = [];
        
        // Encrypt account_number with deterministic encryption
        if (member.account_number && !isEncrypted(member.account_number)) {
          updates.push('account_number = ?');
          values.push(encryptDeterministic(member.account_number));
        }
        
        // Encrypt title with standard encryption
        if (member.title && !isEncrypted(member.title)) {
          updates.push('title = ?');
          values.push(encrypt(member.title));
        }
        
        // Encrypt state with standard encryption
        if (member.state && !isEncrypted(member.state)) {
          updates.push('state = ?');
          values.push(encrypt(member.state));
        }
        
        if (updates.length > 0) {
          values.push(member.id);
          await connection.execute(
            `UPDATE members SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
            values
          );
          encrypted++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`  Error encrypting member ${member.id}:`, error.message);
        errors++;
      }
    }
    
    processed += members.length;
    if (processed % 5000 === 0 || processed === totalCount) {
      console.log(`  Processed ${processed}/${totalCount} members (${encrypted} encrypted, ${skipped} skipped, ${errors} errors)`);
    }
  }
  
  console.log(`\nMembers summary:`);
  console.log(`  - Encrypted: ${encrypted}`);
  console.log(`  - Already encrypted/empty: ${skipped}`);
  console.log(`  - Errors: ${errors}`);
  
  return { encrypted, skipped, errors };
}

async function migrateQuarterlyUserStatements(connection) {
  console.log('\n=== Migrating quarterly_user_statements table (account_number) ===');
  
  // Get count
  const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM quarterly_user_statements');
  const totalCount = countResult[0].count;
  console.log(`Found ${totalCount} statements to check`);
  
  let processed = 0;
  let encrypted = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process in batches
  while (processed < totalCount) {
    // Note: LIMIT/OFFSET don't work well as placeholders in MySQL prepared statements
    const [statements] = await connection.query(
      `SELECT id, account_number FROM quarterly_user_statements LIMIT ${BATCH_SIZE} OFFSET ${processed}`
    );
    
    if (statements.length === 0) break;
    
    for (const statement of statements) {
      try {
        // Encrypt account_number with deterministic encryption
        if (statement.account_number && !isEncrypted(statement.account_number)) {
          const encryptedAccountNumber = encryptDeterministic(statement.account_number);
          
          await connection.execute(
            'UPDATE quarterly_user_statements SET account_number = ?, updated_at = NOW() WHERE id = ?',
            [encryptedAccountNumber, statement.id]
          );
          encrypted++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`  Error encrypting statement ${statement.id}:`, error.message);
        errors++;
      }
    }
    
    processed += statements.length;
    if (processed % 5000 === 0 || processed === totalCount) {
      console.log(`  Processed ${processed}/${totalCount} statements (${encrypted} encrypted, ${skipped} skipped, ${errors} errors)`);
    }
  }
  
  console.log(`\nQuarterly statements summary:`);
  console.log(`  - Encrypted: ${encrypted}`);
  console.log(`  - Already encrypted/empty: ${skipped}`);
  console.log(`  - Errors: ${errors}`);
  
  return { encrypted, skipped, errors };
}

async function migrateNoPlayPlayers(connection) {
  console.log('\n=== Migrating no_play_players table (account_number) ===');
  
  // Get count
  const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM no_play_players');
  const totalCount = countResult[0].count;
  console.log(`Found ${totalCount} players to check`);
  
  let processed = 0;
  let encrypted = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process in batches
  while (processed < totalCount) {
    // Note: LIMIT/OFFSET don't work well as placeholders in MySQL prepared statements
    const [players] = await connection.query(
      `SELECT id, account_number FROM no_play_players LIMIT ${BATCH_SIZE} OFFSET ${processed}`
    );
    
    if (players.length === 0) break;
    
    for (const player of players) {
      try {
        // Encrypt account_number with deterministic encryption
        if (player.account_number && !isEncrypted(player.account_number)) {
          const encryptedAccountNumber = encryptDeterministic(player.account_number);
          
          await connection.execute(
            'UPDATE no_play_players SET account_number = ?, updated_at = NOW() WHERE id = ?',
            [encryptedAccountNumber, player.id]
          );
          encrypted++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`  Error encrypting player ${player.id}:`, error.message);
        errors++;
      }
    }
    
    processed += players.length;
    if (processed % 5000 === 0 || processed === totalCount) {
      console.log(`  Processed ${processed}/${totalCount} players (${encrypted} encrypted, ${skipped} skipped, ${errors} errors)`);
    }
  }
  
  console.log(`\nNo-play players summary:`);
  console.log(`  - Encrypted: ${encrypted}`);
  console.log(`  - Already encrypted/empty: ${skipped}`);
  console.log(`  - Errors: ${errors}`);
  
  return { encrypted, skipped, errors };
}

async function main() {
  console.log('===========================================');
  console.log('  Additional Fields Encryption Migration');
  console.log('===========================================');
  console.log('\nThis script encrypts:');
  console.log('  - members: account_number (DENC), title (ENC), state (ENC)');
  console.log('  - quarterly_user_statements: account_number (DENC)');
  console.log('  - no_play_players: account_number (DENC)');
  console.log('\nDENC = Deterministic encryption (allows lookups)');
  console.log('ENC = Standard encryption (random IV)');
  
  // Validate encryption key
  try {
    getEncryptionKey();
    console.log('\n✓ Encryption key validated');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
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
  
  const results = {
    members: { encrypted: 0, skipped: 0, errors: 0 },
    quarterly: { encrypted: 0, skipped: 0, errors: 0 },
    noPlay: { encrypted: 0, skipped: 0, errors: 0 },
  };
  
  try {
    // Note: Not using transaction for large migrations to avoid lock timeouts
    // Each record is updated individually
    
    results.members = await migrateMembers(connection);
    results.quarterly = await migrateQuarterlyUserStatements(connection);
    results.noPlay = await migrateNoPlayPlayers(connection);
    
    // Print final summary
    console.log('\n===========================================');
    console.log('  Migration Summary');
    console.log('===========================================');
    
    const totalEncrypted = results.members.encrypted + results.quarterly.encrypted + results.noPlay.encrypted;
    const totalSkipped = results.members.skipped + results.quarterly.skipped + results.noPlay.skipped;
    const totalErrors = results.members.errors + results.quarterly.errors + results.noPlay.errors;
    
    console.log(`\nTotal records encrypted: ${totalEncrypted}`);
    console.log(`Total records skipped: ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    
    if (totalErrors > 0) {
      console.log('\n⚠ Migration completed with errors. Please review the logs above.');
    } else {
      console.log('\n✓ Migration completed successfully!');
    }
    
  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run migration
main().catch(console.error);

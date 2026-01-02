/**
 * Script to update is_email column in no_play_players table
 * based on email_tracking records
 * 
 * This script:
 * 1. Finds all no_play_players records
 * 2. Checks if there's a corresponding email_tracking record with:
 *    - Matching batch_id
 *    - email_type = 'no-play' or 'play'
 * 3. Sets is_email = 1 if email was sent, 0 otherwise
 * 
 * Usage:
 *   ENCRYPTION_KEY=your_64_char_hex_key node scripts/update-is-email-from-email-tracking.js
 * 
 * Or if ENCRYPTION_KEY is in .env:
 *   node scripts/update-is-email-from-email-tracking.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

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

// Decrypt function (handles both ENC: and DENC: formats)
function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  
  // Check if data is encrypted (starts with ENC: or DENC:)
  const isStandardEncrypted = encryptedText.startsWith('ENC:');
  const isDeterministicEncrypted = encryptedText.startsWith('DENC:');
  
  if (!isStandardEncrypted && !isDeterministicEncrypted) {
    // Return original unencrypted data (legacy/migration support)
    return encryptedText;
  }
  
  try {
    const key = getEncryptionKey();
    
    // Remove ENC: or DENC: prefix and split by colon
    const prefixLength = isDeterministicEncrypted ? 5 : 4;
    const parts = encryptedText.substring(prefixLength).split(':');
    if (parts.length !== 3) {
      // Invalid format, return original
      return encryptedText;
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // If decryption fails, return original (might be plain text or wrong key)
    return encryptedText;
  }
}

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
};

const BATCH_SIZE = 1000;

async function updateIsEmailFromEmailTracking() {
  let connection;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('Starting update of is_email column in no_play_players table...\n');
    
    // First, reset all is_email to 0
    console.log('Resetting all is_email values to 0...');
    const [resetResult] = await connection.execute(
      'UPDATE no_play_players SET is_email = 0'
    );
    console.log(`Reset ${resetResult.affectedRows} records\n`);
    
    // Get count of records to process
    const [countResult] = await connection.execute(
      'SELECT COUNT(*) as count FROM no_play_players'
    );
    const totalCount = countResult[0].count;
    console.log(`Found ${totalCount} no_play_players records to process\n`);
    
    let processed = 0;
    let updated = 0;
    let errors = 0;
    
    // Process in batches
    while (processed < totalCount) {
      // Get batch of no_play_players
      const [players] = await connection.query(
        `SELECT id, batch_id, account_number 
         FROM no_play_players 
         LIMIT ${BATCH_SIZE} OFFSET ${processed}`
      );
      
      if (players.length === 0) break;
      
      console.log(`Processing batch: ${processed + 1} to ${processed + players.length} of ${totalCount}...`);
      
      for (const player of players) {
        try {
          // Decrypt account_number for matching
          const decryptedAccount = decrypt(player.account_number);
          
          // Check if there's an email_tracking record for this player
          // Match by batch_id (primary) and account_number (secondary)
          // Try both encrypted and decrypted account numbers
          const [emailRecords] = await connection.execute(
            `SELECT id 
             FROM email_tracking 
             WHERE batch_id = ? 
             AND email_type IN ('no-play', 'play')
             AND (
               recipient_account = ? 
               OR recipient_account = ?
             )
             LIMIT 1`,
            [
              player.batch_id,
              player.account_number, // Try encrypted account (if recipient_account is also encrypted)
              decryptedAccount        // Try decrypted account (if recipient_account is plain)
            ]
          );
          
          // If email record exists, set is_email = 1
          if (emailRecords.length > 0) {
            await connection.execute(
              'UPDATE no_play_players SET is_email = 1, updated_at = NOW() WHERE id = ?',
              [player.id]
            );
            updated++;
          }
          
        } catch (error) {
          console.error(`  Error processing player ${player.id}:`, error.message);
          errors++;
        }
      }
      
      processed += players.length;
      
      // Progress update
      if (processed % 5000 === 0 || processed === totalCount) {
        console.log(`  Progress: ${processed}/${totalCount} (${updated} updated, ${errors} errors)\n`);
      }
    }
    
    console.log('\n=== Update Complete ===');
    console.log(`Total processed: ${processed}`);
    console.log(`Records updated (is_email = 1): ${updated}`);
    console.log(`Records with errors: ${errors}`);
    console.log(`Records not updated (is_email = 0): ${processed - updated - errors}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run the script
if (require.main === module) {
  updateIsEmailFromEmailTracking()
    .then(() => {
      console.log('\nScript completed successfully.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nScript failed:', error);
      process.exit(1);
    });
}

module.exports = { updateIsEmailFromEmailTracking };


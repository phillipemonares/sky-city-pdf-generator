/**
 * Script to remove duplicate members by account_number
 * 
 * This script properly handles encrypted account numbers by:
 * 1. Fetching all members
 * 2. Decrypting all account numbers
 * 3. Normalizing them (trimming whitespace)
 * 4. Finding duplicates based on normalized decrypted values
 * 5. Keeping the most recent record per account
 * 6. Deleting the duplicates
 * 
 * Usage:
 *   node scripts/remove-duplicate-members-v2.js [--dry-run] [--preview-only]
 * 
 * Options:
 *   --dry-run: Show what would be deleted without actually deleting
 *   --preview-only: Only show duplicates, don't delete anything
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
};

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('--preview-only');
const previewOnly = args.includes('--preview-only');

// Normalize account number (same as normalizeAccount in pdf-shared.ts)
function normalizeAccount(value) {
  return (value ?? '').toString().trim();
}

// Decrypt value (handles both encrypted and unencrypted)
function decryptValue(encryptedText) {
  if (!encryptedText) return encryptedText;
  
  // Check if encrypted (starts with ENC: or DENC:)
  if (!encryptedText.startsWith('ENC:') && !encryptedText.startsWith('DENC:')) {
    return encryptedText; // Unencrypted
  }
  
  // If encryption key not set, return as-is
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    return encryptedText; // Can't decrypt
  }
  
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const ALGORITHM = 'aes-256-gcm';
    const prefixLength = encryptedText.startsWith('DENC:') ? 5 : 4;
    const parts = encryptedText.substring(prefixLength).split(':');
    
    if (parts.length !== 3) {
      return encryptedText; // Invalid format
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // Decryption failed, return original
    console.warn(`Warning: Failed to decrypt value: ${encryptedText.substring(0, 30)}...`);
    return encryptedText;
  }
}

function isEncryptionEnabled() {
  return Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64);
}

async function findDuplicates(connection) {
  console.log('\n=== Fetching all members and decrypting account numbers ===\n');
  
  // Get all members
  const [members] = await connection.execute(
    `SELECT id, account_number, first_name, last_name, email, created_at, updated_at 
     FROM members 
     ORDER BY updated_at DESC, created_at DESC, id DESC`
  );
  
  console.log(`Found ${members.length} total members in database\n`);
  
  // Decrypt and normalize all account numbers
  const membersWithDecryptedAccounts = members.map(member => {
    const decryptedAccount = decryptValue(member.account_number || '');
    const normalizedAccount = normalizeAccount(decryptedAccount);
    
    return {
      ...member,
      decrypted_account_number: decryptedAccount,
      normalized_account_number: normalizedAccount
    };
  });
  
  // Group by normalized account number
  const accountMap = new Map();
  
  for (const member of membersWithDecryptedAccounts) {
    const key = member.normalized_account_number;
    
    // Skip empty account numbers
    if (!key) {
      continue;
    }
    
    if (!accountMap.has(key)) {
      accountMap.set(key, []);
    }
    accountMap.get(key).push(member);
  }
  
  // Find duplicates
  const duplicates = [];
  for (const [normalizedAccount, membersList] of accountMap.entries()) {
    if (membersList.length > 1) {
      duplicates.push({
        normalized_account_number: normalizedAccount,
        count: membersList.length,
        members: membersList
      });
    }
  }
  
  return duplicates;
}

async function removeDuplicates(connection, duplicates, dryRun = false) {
  console.log(`\n=== ${dryRun ? 'DRY RUN: Would remove' : 'Removing'} duplicates ===\n`);
  
  let totalDeleted = 0;
  const deletedIds = [];
  
  for (const duplicate of duplicates) {
    const { normalized_account_number, members } = duplicate;
    
    // Keep the first one (most recent), delete the rest
    const toKeep = members[0];
    const toDelete = members.slice(1);
    
    console.log(`Account: ${normalized_account_number}`);
    console.log(`  Count: ${members.length} records`);
    console.log(`  Keeping: ${toKeep.id} (updated: ${toKeep.updated_at}, created: ${toKeep.created_at})`);
    
    // Show encrypted account number for reference
    if (toKeep.account_number !== normalized_account_number) {
      console.log(`    Encrypted value: ${toKeep.account_number.substring(0, 50)}...`);
    }
    
    for (const member of toDelete) {
      const firstName = decryptValue(member.first_name || '');
      const lastName = decryptValue(member.last_name || '');
      console.log(`  ${dryRun ? 'Would delete' : 'Deleting'}: ${member.id}`);
      console.log(`    Name: ${firstName} ${lastName}`);
      console.log(`    Updated: ${member.updated_at}, Created: ${member.created_at}`);
      
      if (!dryRun) {
        await connection.execute(
          `DELETE FROM members WHERE id = ?`,
          [member.id]
        );
        deletedIds.push(member.id);
        totalDeleted++;
      } else {
        deletedIds.push(member.id);
        totalDeleted++;
      }
    }
    console.log('');
  }
  
  return { totalDeleted, deletedIds };
}

async function main() {
  const connection = await mysql.createConnection(dbConfig);
  
  try {
    console.log('=== Remove Duplicate Members Script (v2) ===');
    console.log(`Mode: ${previewOnly ? 'Preview Only' : isDryRun ? 'Dry Run' : 'Live'}`);
    console.log(`Encryption: ${isEncryptionEnabled() ? 'Enabled (will decrypt for comparison)' : 'Disabled'}\n`);
    
    // Find duplicates
    const duplicates = await findDuplicates(connection);
    
    if (duplicates.length === 0) {
      console.log('✓ No duplicate members found!');
      return;
    }
    
    // Show summary
    console.log(`\n=== Found ${duplicates.length} account numbers with duplicates ===`);
    const totalDuplicates = duplicates.reduce((sum, d) => sum + (d.count - 1), 0);
    console.log(`Total duplicate records to remove: ${totalDuplicates}\n`);
    
    // Show details
    console.log('Duplicate details:');
    for (const duplicate of duplicates) {
      console.log(`\n  Account: ${duplicate.normalized_account_number}`);
      console.log(`  Count: ${duplicate.count} records`);
      console.log(`  Records:`);
      for (let i = 0; i < duplicate.members.length; i++) {
        const member = duplicate.members[i];
        const firstName = decryptValue(member.first_name || '');
        const lastName = decryptValue(member.last_name || '');
        const email = decryptValue(member.email || '');
        const status = i === 0 ? ' [KEEP]' : ' [DELETE]';
        console.log(`    ${i + 1}. ID: ${member.id}${status}`);
        console.log(`       Name: ${firstName} ${lastName}`);
        console.log(`       Email: ${email}`);
        console.log(`       Updated: ${member.updated_at}, Created: ${member.created_at}`);
        if (member.account_number !== duplicate.normalized_account_number) {
          console.log(`       Encrypted: ${member.account_number.substring(0, 50)}...`);
        }
      }
    }
    
    if (previewOnly) {
      console.log('\n✓ Preview complete. Run without --preview-only to see deletion plan.');
      return;
    }
    
    // Ask for confirmation (unless dry-run)
    if (!isDryRun) {
      console.log(`\n⚠️  WARNING: This will delete ${totalDuplicates} duplicate records!`);
      console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Remove duplicates
    const { totalDeleted, deletedIds } = await removeDuplicates(connection, duplicates, isDryRun);
    
    if (isDryRun) {
      console.log(`\n✓ DRY RUN: Would delete ${totalDeleted} records`);
      console.log('Run without --dry-run to actually delete these records.');
    } else {
      console.log(`\n✓ Successfully deleted ${totalDeleted} duplicate records`);
      console.log(`Deleted IDs: ${deletedIds.join(', ')}`);
    }
    
  } catch (error) {
    console.error('\n✗ Error:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run the script
main().catch(console.error);

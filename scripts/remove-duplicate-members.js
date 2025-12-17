/**
 * Script to remove duplicate members by account_number
 * 
 * This script:
 * 1. Finds all duplicate members based on account_number
 * 2. Keeps the most recent record (by updated_at, then created_at, then id)
 * 3. Deletes the duplicate records
 * 
 * Works with both encrypted and unencrypted account numbers.
 * Since account_number uses deterministic encryption, duplicates will have
 * the same encrypted value, so we can find them directly in SQL.
 * 
 * Usage:
 *   node scripts/remove-duplicate-members.js [--dry-run] [--preview-only]
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

// Simple decryption helper (handles both encrypted and unencrypted)
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
    return encryptedText;
  }
}

function isEncryptionEnabled() {
  return Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64);
}

async function findDuplicates(connection) {
  console.log('\n=== Finding duplicate members by account_number ===\n');
  
  // Get all members
  const [members] = await connection.execute(
    `SELECT id, account_number, first_name, last_name, email, created_at, updated_at 
     FROM members 
     ORDER BY account_number, updated_at DESC, created_at DESC, id DESC`
  );
  
  // Group by account_number (works with encrypted values since deterministic encryption
  // means same account number = same encrypted value)
  const accountMap = new Map();
  
  for (const member of members) {
    const accountNumber = member.account_number || '';
    
    if (!accountMap.has(accountNumber)) {
      accountMap.set(accountNumber, []);
    }
    accountMap.get(accountNumber).push(member);
  }
  
  // Find duplicates
  const duplicates = [];
  for (const [accountNumber, membersList] of accountMap.entries()) {
    if (membersList.length > 1) {
      // Try to decrypt for display
      const decryptedAccount = decryptValue(accountNumber);
      duplicates.push({
        account_number: accountNumber, // Store encrypted value for deletion
        account_number_display: decryptedAccount, // Decrypted for display
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
      const { account_number, account_number_display, members } = duplicate;
      
      // Keep the first one (most recent), delete the rest
      const toKeep = members[0];
      const toDelete = members.slice(1);
      
      const accountDisplay = account_number_display !== account_number 
        ? `${account_number_display} (${account_number.substring(0, 20)}...)`
        : account_number;
      console.log(`Account: ${accountDisplay}`);
      console.log(`  Keeping: ${toKeep.id} (updated: ${toKeep.updated_at}, created: ${toKeep.created_at})`);
      
      for (const member of toDelete) {
        console.log(`  ${dryRun ? 'Would delete' : 'Deleting'}: ${member.id} (updated: ${member.updated_at}, created: ${member.created_at})`);
        
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
    console.log('=== Remove Duplicate Members Script ===');
    console.log(`Mode: ${previewOnly ? 'Preview Only' : isDryRun ? 'Dry Run' : 'Live'}`);
    console.log(`Encryption: ${isEncryptionEnabled() ? 'Enabled (will decrypt for display)' : 'Disabled'}\n`);
    
    // Find duplicates
    const duplicates = await findDuplicates(connection);
    
    if (duplicates.length === 0) {
      console.log('✓ No duplicate members found!');
      return;
    }
    
    // Show summary
    console.log(`Found ${duplicates.length} account numbers with duplicates:`);
    const totalDuplicates = duplicates.reduce((sum, d) => sum + (d.count - 1), 0);
    console.log(`Total duplicate records: ${totalDuplicates}\n`);
    
    // Show details
    console.log('Duplicate details:');
    for (const duplicate of duplicates) {
      const accountDisplay = duplicate.account_number_display !== duplicate.account_number 
        ? `${duplicate.account_number_display} (encrypted: ${duplicate.account_number.substring(0, 20)}...)`
        : duplicate.account_number;
      console.log(`\n  Account: ${accountDisplay}`);
      console.log(`  Count: ${duplicate.count} records`);
      console.log(`  Records:`);
      for (const member of duplicate.members) {
        // Try to decrypt name fields for display
        const firstName = decryptValue(member.first_name || '');
        const lastName = decryptValue(member.last_name || '');
        const email = decryptValue(member.email || '');
        console.log(`    - ID: ${member.id}, Updated: ${member.updated_at}, Created: ${member.created_at}`);
        console.log(`      Name: ${firstName} ${lastName}, Email: ${email}`);
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

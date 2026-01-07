#!/usr/bin/env python3
"""
Update is_email column in no_play_players table based on CSV file.

This script:
1. Reads a CSV file with account numbers and Is Email column
2. Matches records in no_play_players table by account number
3. Updates is_email column to 1 (True) if CSV shows Is Email = TRUE

Usage:
    python services/update_is_email_no_play_statement.py --csv path/to/file.csv
    python services/update_is_email_no_play_statement.py --csv csv/PreCommitment_Template\(Member\ Contact\).csv
"""

import os
import sys
import csv
import mysql.connector
from mysql.connector import Error
from typing import Dict, Set
from dotenv import load_dotenv
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import argparse

# Load environment variables from .env file
load_dotenv()

# Configuration - can be overridden by environment variables
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'dp-skycity'),
}


def get_db_connection():
    """Create and return a database connection."""
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        if connection.is_connected():
            return connection
    except Error as e:
        print(f"Error connecting to MySQL: {e}")
        sys.exit(1)
    return None


def get_encryption_key():
    """Get encryption key from environment variable."""
    key = os.getenv('ENCRYPTION_KEY')
    if not key:
        return None
    if len(key) != 64:
        return None
    return bytes.fromhex(key)


def decrypt_account(encrypted_account: str) -> str:
    """
    Decrypt an encrypted account number.
    Handles both ENC: (standard) and DENC: (deterministic) formats.
    Returns original string if decryption fails or encryption is not enabled.
    """
    if not encrypted_account:
        return encrypted_account
    
    # Check if data is encrypted
    is_standard_encrypted = encrypted_account.startswith('ENC:')
    is_deterministic_encrypted = encrypted_account.startswith('DENC:')
    
    if not is_standard_encrypted and not is_deterministic_encrypted:
        # Not encrypted, return as-is
        return encrypted_account
    
    key = get_encryption_key()
    if not key:
        # Encryption key not available, return as-is
        return encrypted_account
    
    try:
        # Remove prefix and split
        prefix_length = 5 if is_deterministic_encrypted else 4
        parts = encrypted_account[prefix_length:].split(':')
        if len(parts) != 3:
            return encrypted_account
        
        iv_hex, auth_tag_hex, encrypted_hex = parts
        iv = bytes.fromhex(iv_hex)
        auth_tag = bytes.fromhex(auth_tag_hex)
        encrypted_data = bytes.fromhex(encrypted_hex)
        
        # For AES-GCM, combine encrypted data with auth tag
        # The auth tag is 16 bytes and should be appended to ciphertext
        ciphertext_with_tag = encrypted_data + auth_tag
        
        # Decrypt using AESGCM
        aesgcm = AESGCM(key)
        decrypted = aesgcm.decrypt(iv, ciphertext_with_tag, None)
        return decrypted.decode('utf-8')
    except Exception as e:
        # If decryption fails, return original (might be wrong key or corrupted data)
        return encrypted_account


def normalize_account(account: str) -> str:
    """Normalize account number (remove spaces, convert to string)."""
    if account is None:
        return ""
    return str(account).strip().replace(" ", "")


def read_csv_accounts(csv_path: str) -> Dict[str, bool]:
    """
    Read CSV file and extract account numbers where Is Email is TRUE.
    
    Returns:
        Dictionary mapping normalized account numbers to True if Is Email is TRUE
    """
    accounts_to_update = {}
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as csvfile:
            # Try to detect delimiter
            sample = csvfile.read(1024)
            csvfile.seek(0)
            sniffer = csv.Sniffer()
            delimiter = sniffer.sniff(sample).delimiter
            
            reader = csv.DictReader(csvfile, delimiter=delimiter)
            
            # Find the column names (handle variations)
            fieldnames = reader.fieldnames
            if not fieldnames:
                print("Error: CSV file has no headers")
                return accounts_to_update
            
            # Find account column (Acct, Account, etc.)
            account_col = None
            is_email_col = None
            
            for col in fieldnames:
                col_lower = col.strip().lower()
                if col_lower in ['acct', 'account', 'account number', 'account_number']:
                    account_col = col
                elif col_lower in ['is email', 'is_email', 'email', 'email enabled']:
                    is_email_col = col
            
            if not account_col:
                print("Error: Could not find account column in CSV")
                print(f"Available columns: {', '.join(fieldnames)}")
                return accounts_to_update
            
            if not is_email_col:
                print("Error: Could not find 'Is Email' column in CSV")
                print(f"Available columns: {', '.join(fieldnames)}")
                return accounts_to_update
            
            print(f"Using account column: '{account_col}'")
            print(f"Using Is Email column: '{is_email_col}'")
            
            row_count = 0
            true_count = 0
            
            for row in reader:
                row_count += 1
                account = row.get(account_col, '').strip()
                is_email_str = row.get(is_email_col, '').strip().upper()
                
                if not account:
                    continue
                
                # Check if Is Email is TRUE
                is_email_true = is_email_str in ['TRUE', '1', 'YES', 'Y', 'T']
                
                if is_email_true:
                    normalized_account = normalize_account(account)
                    if normalized_account:
                        accounts_to_update[normalized_account] = True
                        true_count += 1
            
            print(f"\nCSV Summary:")
            print(f"  Total rows processed: {row_count}")
            print(f"  Accounts with Is Email = TRUE: {true_count}")
            print(f"  Accounts to update: {len(accounts_to_update)}")
            
    except FileNotFoundError:
        print(f"Error: CSV file not found: {csv_path}")
        sys.exit(1)
    except Exception as e:
        print(f"Error reading CSV file: {e}")
        sys.exit(1)
    
    return accounts_to_update


def update_is_email_from_csv(csv_path: str, dry_run: bool = False):
    """
    Main function to update is_email column in no_play_players table.
    
    Args:
        csv_path: Path to the CSV file
        dry_run: If True, only show what would be updated without making changes
    """
    print("=" * 60)
    print("Update is_email in no_play_players table from CSV")
    print("=" * 60)
    
    if dry_run:
        print("\n*** DRY RUN MODE - No changes will be made ***\n")
    
    # Read CSV and get accounts to update
    print(f"\nReading CSV file: {csv_path}")
    accounts_to_update = read_csv_accounts(csv_path)
    
    if not accounts_to_update:
        print("\nNo accounts found with Is Email = TRUE. Exiting.")
        return
    
    # Connect to database
    print("\nConnecting to database...")
    connection = get_db_connection()
    
    try:
        cursor = connection.cursor(dictionary=True)
        
        # Get all no_play_players records
        print("\nFetching all no_play_players records from database...")
        cursor.execute("""
            SELECT id, account_number, is_email
            FROM no_play_players
        """)
        all_players = cursor.fetchall()
        
        print(f"Found {len(all_players)} records in no_play_players table")
        
        # Match and update
        matched_count = 0
        updated_count = 0
        not_found_accounts = set(accounts_to_update.keys())
        
        print("\nMatching accounts and updating is_email...")
        print("-" * 60)
        
        for player in all_players:
            # Decrypt account number if needed
            encrypted_account = player['account_number']
            decrypted_account = decrypt_account(encrypted_account)
            normalized_db_account = normalize_account(decrypted_account)
            
            # Also try matching with encrypted account (in case CSV has encrypted values)
            normalized_encrypted_account = normalize_account(encrypted_account)
            
            # Check if this account should be updated
            should_update = False
            matched_account = None
            
            if normalized_db_account in accounts_to_update:
                should_update = True
                matched_account = normalized_db_account
                not_found_accounts.discard(normalized_db_account)
            elif normalized_encrypted_account in accounts_to_update:
                should_update = True
                matched_account = normalized_encrypted_account
                not_found_accounts.discard(normalized_encrypted_account)
            
            if should_update:
                matched_count += 1
                current_is_email = player.get('is_email', 0)
                
                # Only update if not already set to 1
                if current_is_email != 1:
                    if not dry_run:
                        cursor.execute("""
                            UPDATE no_play_players
                            SET is_email = 1, updated_at = NOW()
                            WHERE id = %s
                        """, (player['id'],))
                        connection.commit()
                    updated_count += 1
                    print(f"  ✓ Account {matched_account}: Updated is_email from {current_is_email} to 1")
                else:
                    print(f"  - Account {matched_account}: Already set to 1 (skipped)")
        
        # Summary
        print("-" * 60)
        print(f"\nSummary:")
        print(f"  Accounts in CSV with Is Email = TRUE: {len(accounts_to_update)}")
        print(f"  Matched in database: {matched_count}")
        print(f"  Updated (changed to 1): {updated_count}")
        print(f"  Already set to 1: {matched_count - updated_count}")
        
        if not_found_accounts:
            print(f"\n  Accounts from CSV not found in database: {len(not_found_accounts)}")
            if len(not_found_accounts) <= 20:
                print("  Missing accounts:")
                for acc in sorted(not_found_accounts):
                    print(f"    - {acc}")
            else:
                print("  Missing accounts (first 20):")
                for acc in sorted(list(not_found_accounts))[:20]:
                    print(f"    - {acc}")
                print(f"    ... and {len(not_found_accounts) - 20} more")
        
        if dry_run:
            print("\n*** DRY RUN - No changes were made ***")
        else:
            print(f"\n✓ Update completed successfully!")
        
        cursor.close()
    
    except Error as e:
        print(f"\nError updating database: {e}")
        if connection:
            connection.rollback()
        sys.exit(1)
    
    finally:
        if connection and connection.is_connected():
            connection.close()
            print("\nDatabase connection closed.")


def main():
    """Entry point for the script."""
    parser = argparse.ArgumentParser(
        description='Update is_email column in no_play_players table from CSV file'
    )
    parser.add_argument(
        '--csv',
        type=str,
        required=True,
        help='Path to CSV file (e.g., csv/PreCommitment_Template(Member Contact).csv)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Perform a dry run without making any changes'
    )
    
    args = parser.parse_args()
    
    update_is_email_from_csv(args.csv, dry_run=args.dry_run)


if __name__ == "__main__":
    main()


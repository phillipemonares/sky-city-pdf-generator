#!/usr/bin/env python3
"""
Send No-Play Email Service
Queries accounts from no-play batches and sends precommitment emails using the API.
"""

import os
import sys
import mysql.connector
from mysql.connector import Error
import requests
from typing import List, Dict, Optional
from datetime import datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
import json

# Load environment variables from .env file
load_dotenv()

# Configuration - can be overridden by environment variables
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'dp-skycity'),
}

API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:3000')
API_TOKEN = os.getenv('QUARTERLY_PDF_API_TOKEN', '')
API_ENDPOINT = '/api/send-no-play-email'


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


def get_all_no_play_batches(connection) -> List[Dict]:
    """Query all no-play generation batches from the database."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
            SELECT id, statement_period, statement_date, generation_date, 
                   total_players, created_at, updated_at
            FROM no_play_batches 
            ORDER BY generation_date DESC
        """
        cursor.execute(query)
        batches = cursor.fetchall()
        cursor.close()
        return batches
    except Error as e:
        print(f"Error querying no-play batches: {e}")
        return []


def get_no_play_batch_by_id(connection, batch_id: str) -> Optional[Dict]:
    """Get a specific no-play batch by ID."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
            SELECT id, statement_period, statement_date, generation_date, 
                   total_players, created_at, updated_at
            FROM no_play_batches 
            WHERE id = %s
        """
        cursor.execute(query, (batch_id,))
        batch = cursor.fetchone()
        cursor.close()
        return batch
    except Error as e:
        print(f"Error querying no-play batch: {e}")
        return None


def get_no_play_accounts_from_batch(connection, batch_id: str) -> List[Dict]:
    """Query all accounts from no_play_players for a specific batch."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
            SELECT id, batch_id, account_number, player_data, 
                   no_play_status, is_email, created_at, updated_at
            FROM no_play_players
            WHERE batch_id = %s
            ORDER BY account_number
        """
        cursor.execute(query, (batch_id,))
        accounts = cursor.fetchall()
        cursor.close()
        return accounts
    except Error as e:
        print(f"Error querying no-play accounts from batch: {e}")
        return []


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
        ciphertext_with_tag = encrypted_data + auth_tag
        
        # Decrypt using AESGCM
        aesgcm = AESGCM(key)
        decrypted = aesgcm.decrypt(iv, ciphertext_with_tag, None)
        return decrypted.decode('utf-8')
    except Exception as e:
        # If decryption fails, return original
        return encrypted_account


def decrypt_json(encrypted_json: str) -> Optional[dict]:
    """
    Decrypt an encrypted JSON string.
    Returns None if decryption fails.
    """
    if not encrypted_json:
        return None
    
    # If it's not encrypted, try to parse as JSON directly
    if not encrypted_json.startswith('ENC:'):
        try:
            return json.loads(encrypted_json)
        except:
            return None
    
    key = get_encryption_key()
    if not key:
        return None
    
    try:
        # Remove 'ENC:' prefix and split
        parts = encrypted_json[4:].split(':')
        if len(parts) != 3:
            return None
        
        iv_hex, auth_tag_hex, encrypted_hex = parts
        iv = bytes.fromhex(iv_hex)
        auth_tag = bytes.fromhex(auth_tag_hex)
        encrypted_data = bytes.fromhex(encrypted_hex)
        
        # For AES-GCM, combine encrypted data with auth tag
        ciphertext_with_tag = encrypted_data + auth_tag
        
        # Decrypt using AESGCM
        aesgcm = AESGCM(key)
        decrypted = aesgcm.decrypt(iv, ciphertext_with_tag, None)
        return json.loads(decrypted.decode('utf-8'))
    except Exception as e:
        return None


def parse_statement_period(statement_period: str) -> tuple:
    """
    Parse statement_period string to extract start and end dates.
    Format: "1 October 2025 - 31 December 2025"
    Returns: (start_date: str, end_date: str) in YYYY-MM-DD format
    """
    try:
        parts = statement_period.split(' - ')
        if len(parts) != 2:
            return None, None
        
        start_str = parts[0].strip()
        end_str = parts[1].strip()
        
        # Parse dates like "1 October 2025"
        start_date = datetime.strptime(start_str, '%d %B %Y')
        end_date = datetime.strptime(end_str, '%d %B %Y')
        
        return start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')
    except Exception as e:
        print(f"Warning: Could not parse statement_period '{statement_period}': {e}")
        return None, None


def normalize_account(account: str) -> str:
    """Normalize account number (remove spaces, convert to string, decrypt if needed)."""
    if account is None:
        return ""
    
    # First decrypt if encrypted
    decrypted = decrypt_account(str(account))
    
    # Then normalize
    return decrypted.strip().replace(" ", "")


def extract_email_from_player_data(player_data: dict) -> Optional[str]:
    """Extract email from player data JSON."""
    if not player_data:
        return None
    
    try:
        return player_data.get('playerInfo', {}).get('email', None)
    except:
        return None


def send_no_play_email(account: str, start_date: str, end_date: str, email: str, token: str):
    """
    Send no-play email for an account using the API.
    Returns (success: bool, error_message: Optional[str])
    """
    url = f"{API_BASE_URL}{API_ENDPOINT}"
    
    payload = {
        "account": account,
        "startDate": start_date,
        "endDate": end_date,
        "email": email,
        "token": token
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=120)
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                return True, None
            else:
                return False, result.get('error', 'Unknown error')
        else:
            error_msg = f"HTTP {response.status_code}"
            try:
                error_data = response.json()
                error_msg = error_data.get('error', error_msg)
            except:
                error_msg = response.text or error_msg
            return False, error_msg
            
    except requests.exceptions.Timeout:
        return False, "Request timeout"
    except requests.exceptions.ConnectionError:
        return False, "Connection error - is the API server running?"
    except Exception as e:
        return False, str(e)


def send_emails_from_batch(batch_id: str = None, token: str = None, 
                           start_from_index: int = None,
                           filter_no_play_status: str = None):
    """
    Main function to send no-play emails for all accounts in a batch.
    
    Args:
        batch_id: Batch ID to process (if None, will list all batches and prompt)
        token: API authentication token
        start_from_index: Row number to start from (1-indexed, will skip all rows before this)
        filter_no_play_status: Filter by no_play_status ('No Play', 'Play', or None for all)
    """
    token = token or API_TOKEN
    
    if not token:
        print("Error: API token is required. Set QUARTERLY_PDF_API_TOKEN environment variable or pass as argument.")
        sys.exit(1)
    
    # Connect to database
    print("Connecting to database...")
    connection = get_db_connection()
    
    try:
        # If no batch_id provided, list all batches and prompt user
        if not batch_id:
            batches = get_all_no_play_batches(connection)
            
            if not batches:
                print("No no-play batches found in database.")
                return
            
            print("\n" + "=" * 80)
            print("Available No-Play Generation Batches:")
            print("=" * 80)
            for idx, batch in enumerate(batches, 1):
                gen_date = batch['generation_date'].strftime('%Y-%m-%d %H:%M:%S') if batch['generation_date'] else 'N/A'
                statement_period = batch.get('statement_period', 'N/A')
                statement_date = batch.get('statement_date', 'N/A')
                print(f"{idx}. ID: {batch['id']}")
                print(f"   Period: {statement_period}")
                print(f"   Statement Date: {statement_date} | Players: {batch['total_players']}")
                print(f"   Generated: {gen_date}")
                print("-" * 80)
            
            # Prompt user to select a batch
            while True:
                selection = input("\nEnter batch number (or 'q' to quit): ").strip()
                if selection.lower() == 'q':
                    print("Exiting...")
                    return
                
                try:
                    idx = int(selection)
                    if 1 <= idx <= len(batches):
                        batch_id = batches[idx - 1]['id']
                        break
                    else:
                        print(f"Invalid selection. Please enter a number between 1 and {len(batches)}.")
                except ValueError:
                    print("Invalid input. Please enter a number or 'q' to quit.")
        
        # Get batch information
        batch = get_no_play_batch_by_id(connection, batch_id)
        
        if not batch:
            print(f"Error: Batch with ID '{batch_id}' not found.")
            sys.exit(1)
        
        # Get accounts from batch
        print(f"\nFetching accounts from batch {batch_id}...")
        accounts = get_no_play_accounts_from_batch(connection, batch_id)
        
        if not accounts:
            print("No accounts found in this batch.")
            return
        
        total_accounts = len(accounts)
        
        # Filter by no_play_status if specified
        if filter_no_play_status:
            accounts = [acc for acc in accounts if acc.get('no_play_status') == filter_no_play_status]
            print(f"Filtered to {len(accounts)} accounts with status: {filter_no_play_status}")
        
        # Filter accounts if start_from_index is specified
        if start_from_index:
            if start_from_index < 1:
                print(f"Error: start_from_index must be >= 1 (got {start_from_index})")
                sys.exit(1)
            if start_from_index > len(accounts):
                print(f"Error: start_from_index ({start_from_index}) exceeds total accounts ({len(accounts)})")
                sys.exit(1)
            accounts = accounts[start_from_index - 1:]
        
        # Parse statement_period to extract start and end dates
        statement_period = batch.get('statement_period', '')
        start_date, end_date = parse_statement_period(statement_period)
        
        if not start_date or not end_date:
            print("Error: Could not parse statement_period from batch.")
            print(f"Statement period: {statement_period}")
            sys.exit(1)
        
        statement_date = batch.get('statement_date', 'N/A')
        
        # Count accounts by is_email flag and email availability
        accounts_is_email_true = 0
        accounts_is_email_false = 0
        accounts_with_email_data = 0
        accounts_without_email_data = 0
        
        for account_record in accounts:
            is_email = account_record.get('is_email', 0)
            
            if is_email == 1:
                accounts_is_email_true += 1
            else:
                accounts_is_email_false += 1
            
            player_data_json = account_record.get('player_data', '')
            player_data = decrypt_json(player_data_json) if player_data_json else None
            email = extract_email_from_player_data(player_data)
            
            if email and email.strip():
                accounts_with_email_data += 1
            else:
                accounts_without_email_data += 1
        
        # Display summary
        print("\n" + "=" * 80)
        print("EMAIL SENDING SUMMARY")
        print("=" * 80)
        print(f"Batch ID: {batch_id}")
        print(f"Statement Period: {statement_period}")
        print(f"Statement Date: {statement_date}")
        print(f"Date Range (API): {start_date} to {end_date}")
        print(f"Total accounts in batch: {total_accounts}")
        print(f"Accounts to process: {len(accounts)}")
        print(f"\nEmail Preferences (is_email flag):")
        print(f"  - is_email = 1 (opted in): {accounts_is_email_true}")
        print(f"  - is_email = 0 (opted out): {accounts_is_email_false}")
        print(f"\nEmail Data Availability:")
        print(f"  - With email address: {accounts_with_email_data}")
        print(f"  - Without email address: {accounts_without_email_data}")
        print(f"\nNote: Only accounts with is_email=1 AND valid email will be sent.")
        if start_from_index:
            print(f"\nStarting from row: {start_from_index}")
        if filter_no_play_status:
            print(f"Filter: {filter_no_play_status} accounts only")
        print(f"\nAPI URL: {API_BASE_URL}{API_ENDPOINT}")
        print("=" * 80)
        
        # Ask for confirmation
        confirmation = input("\nProceed with sending emails? (Y/N): ").strip().upper()
        
        if confirmation != 'Y':
            print("Email sending cancelled.")
            return
        
        print("\n" + "-" * 80)
        print("Starting email sending process...")
        print("-" * 80)
        
        # Process each account
        success_count = 0
        skipped_count = 0
        error_count = 0
        errors = []
        
        # Calculate starting index for display
        display_start_index = start_from_index if start_from_index else 1
        
        for index, account_record in enumerate(accounts, 1):
            # Calculate actual row number for display
            actual_row = display_start_index + index - 1
            
            # Decrypt account number
            account = normalize_account(account_record.get('account_number', ''))
            
            if not account:
                print(f"[Row {actual_row} / {total_accounts}] Skipping account with empty account number (ID: {account_record.get('id', 'unknown')})")
                error_count += 1
                continue
            
            # Check is_email flag
            is_email = account_record.get('is_email', 0)
            if is_email != 1:
                print(f"[Row {actual_row} / {total_accounts}] Skipping account {account} (is_email=0, opted out)")
                skipped_count += 1
                continue
            
            # Decrypt and extract email from player_data
            player_data_json = account_record.get('player_data', '')
            player_data = decrypt_json(player_data_json) if player_data_json else None
            email = extract_email_from_player_data(player_data)
            
            if not email or not email.strip():
                print(f"[Row {actual_row} / {total_accounts}] Skipping account {account} (no email address)")
                skipped_count += 1
                continue
            
            # Get no_play_status for display
            no_play_status = account_record.get('no_play_status', 'Unknown')
            
            # Show progress
            print(f"[Row {actual_row} / {total_accounts}] Sending email to {account} ({email}) [{no_play_status}]...", end=" ", flush=True)
            
            # Send email
            success, error_msg = send_no_play_email(account, start_date, end_date, email, token)
            
            if success:
                print("✓ Success")
                success_count += 1
            else:
                print(f"✗ Failed: {error_msg}")
                error_count += 1
                errors.append({
                    'account': account,
                    'email': email,
                    'error': error_msg
                })
        
        # Summary
        print("-" * 80)
        print(f"\nEmail sending completed!")
        print(f"Total accounts processed: {len(accounts)}")
        print(f"Successful: {success_count}")
        print(f"Skipped (opted out or no email): {skipped_count}")
        print(f"Failed: {error_count}")
        
        if errors:
            print(f"\nErrors encountered:")
            for error in errors[:10]:  # Show first 10 errors
                print(f"  - Account {error['account']} ({error['email']}): {error['error']}")
            if len(errors) > 10:
                print(f"  ... and {len(errors) - 10} more errors")
    
    finally:
        if connection and connection.is_connected():
            connection.close()
            print("\nDatabase connection closed.")


def main():
    """Entry point for the script."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Send no-play precommitment emails for all accounts in a batch')
    parser.add_argument('--batch-id', type=str, help='Batch ID to process (if not provided, will list all batches)', default=None)
    parser.add_argument('--token', type=str, help='API authentication token', default=API_TOKEN)
    parser.add_argument('--start-from-index', type=int, help='Row number to start from (1-indexed, will skip all rows before this)', default=None)
    parser.add_argument('--filter-status', type=str, choices=['No Play', 'Play'], help='Filter by no_play_status', default=None)
    
    args = parser.parse_args()
    
    send_emails_from_batch(
        batch_id=args.batch_id,
        token=args.token,
        start_from_index=args.start_from_index,
        filter_no_play_status=args.filter_status
    )


if __name__ == "__main__":
    main()

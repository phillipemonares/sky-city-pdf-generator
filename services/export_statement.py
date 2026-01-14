#!/usr/bin/env python3
"""
Export Statement Service (Batch-based)
Queries accounts from a specific generation batch and generates PDFs for each using the API.
"""

import os
import sys
import re
import mysql.connector
from mysql.connector import Error
import requests
from typing import List, Dict, Optional
from datetime import datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from pathlib import Path

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
API_ENDPOINT = '/api/generate-quarterly-pdf'


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


def get_all_batches(connection) -> List[Dict]:
    """Query all generation batches from the database."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
            SELECT id, quarter, year, generation_date, total_accounts, 
                   start_date, end_date, created_at, updated_at
            FROM generation_batches 
            ORDER BY generation_date DESC
        """
        cursor.execute(query)
        batches = cursor.fetchall()
        cursor.close()
        return batches
    except Error as e:
        print(f"Error querying batches: {e}")
        return []


def get_batch_by_id(connection, batch_id: str) -> Optional[Dict]:
    """Get a specific batch by ID."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
            SELECT id, quarter, year, generation_date, total_accounts, 
                   start_date, end_date, created_at, updated_at
            FROM generation_batches 
            WHERE id = %s
        """
        cursor.execute(query, (batch_id,))
        batch = cursor.fetchone()
        cursor.close()
        return batch
    except Error as e:
        print(f"Error querying batch: {e}")
        return None


def get_accounts_from_batch(connection, batch_id: str) -> List[Dict]:
    """Query all accounts from quarterly_user_statements for a specific batch."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
            SELECT id, batch_id, account_number, data, created_at, updated_at
            FROM quarterly_user_statements
            WHERE batch_id = %s
            ORDER BY account_number
        """
        cursor.execute(query, (batch_id,))
        accounts = cursor.fetchall()
        cursor.close()
        return accounts
    except Error as e:
        print(f"Error querying accounts from batch: {e}")
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


def normalize_account(account: str) -> str:
    """Normalize account number (remove spaces, convert to string, decrypt if needed)."""
    if account is None:
        return ""
    
    # First decrypt if encrypted
    decrypted = decrypt_account(str(account))
    
    # Then normalize
    return decrypted.strip().replace(" ", "")


def get_expected_pdf_path(account: str, quarter: int, year: int, uploads_dir: str = 'uploads') -> Path:
    """
    Get the expected PDF file path for an account.
    Returns Path object for the expected file location.
    """
    quarter_folder = f"q{quarter}-{year}"
    
    # Sanitize account number (same as API does: replace(/[^a-zA-Z0-9_-]/g, ''))
    sanitized_account = re.sub(r'[^a-zA-Z0-9_-]', '', account) or 'member'
    
    filename = f"Statement_Q{quarter}_{year}_{sanitized_account}.pdf"
    return Path(uploads_dir) / quarter_folder / filename


def pdf_exists(account: str, quarter: int, year: int, uploads_dir: str = 'uploads', check_all_quarters: bool = True) -> tuple:
    """
    Check if PDF file already exists for an account.
    
    Args:
        account: Account number
        quarter: Quarter number (1-4)
        year: Year
        uploads_dir: Base uploads directory
        check_all_quarters: If True, check all quarter folders; if False, only check current quarter
    
    Returns:
        (exists: bool, found_path: Optional[str]) - Tuple indicating if PDF exists and where it was found
    """
    # First check the expected path for this quarter
    pdf_path = get_expected_pdf_path(account, quarter, year, uploads_dir)
    if pdf_path.exists() and pdf_path.is_file():
        return True, str(pdf_path)
    
    # If check_all_quarters is enabled, search all quarter folders
    if check_all_quarters:
        uploads_path = Path(uploads_dir)
        if not uploads_path.exists():
            return False, None
        
        # Sanitize account number
        sanitized_account = re.sub(r'[^a-zA-Z0-9_-]', '', account) or 'member'
        
        # Search all quarter folders (q1-2024, q2-2024, q3-2025, etc.)
        for quarter_folder in uploads_path.iterdir():
            if not quarter_folder.is_dir():
                continue
            
            # Check if it's a quarter folder (format: q{1-4}-{year})
            folder_name = quarter_folder.name
            if not re.match(r'^q[1-4]-\d{4}$', folder_name):
                continue
            
            # Check for PDF with this account number
            # Pattern: Statement_Q{quarter}_{year}_{account}.pdf
            pdf_pattern = f"Statement_Q*_{sanitized_account}.pdf"
            
            for pdf_file in quarter_folder.glob(pdf_pattern):
                if pdf_file.is_file():
                    return True, str(pdf_file)
    
    return False, None


def generate_pdf_for_member(account: str, start_date: str, end_date: str, token: str):
    """
    Generate PDF for a member using the API.
    Returns (success: bool, error_message: Optional[str])
    """
    url = f"{API_BASE_URL}{API_ENDPOINT}"
    
    payload = {
        "account": account,
        "startDate": start_date,
        "endDate": end_date,
        "token": token
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=300)
        
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


def export_statements_from_batch(batch_id: str = None, token: str = None, 
                                  start_from_index: int = None,
                                  skip_existing: bool = False, 
                                  uploads_dir: str = 'uploads'):
    """
    Main function to export statements for all accounts in a batch.
    
    Args:
        batch_id: Batch ID to process (if None, will list all batches and prompt)
        token: API authentication token
        start_from_index: Row number to start from (1-indexed, will skip all rows before this)
        skip_existing: If True, skip accounts that already have PDF files
        uploads_dir: Directory where PDFs are stored (default: 'uploads')
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
            batches = get_all_batches(connection)
            
            if not batches:
                print("No batches found in database.")
                return
            
            print("\n" + "=" * 80)
            print("Available Generation Batches:")
            print("=" * 80)
            for idx, batch in enumerate(batches, 1):
                gen_date = batch['generation_date'].strftime('%Y-%m-%d %H:%M:%S') if batch['generation_date'] else 'N/A'
                start_date = batch['start_date'].strftime('%Y-%m-%d') if batch['start_date'] else 'N/A'
                end_date = batch['end_date'].strftime('%Y-%m-%d') if batch['end_date'] else 'N/A'
                print(f"{idx}. ID: {batch['id']}")
                print(f"   Q{batch['quarter']} {batch['year']} | Accounts: {batch['total_accounts']}")
                print(f"   Period: {start_date} to {end_date}")
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
        batch = get_batch_by_id(connection, batch_id)
        
        if not batch:
            print(f"Error: Batch with ID '{batch_id}' not found.")
            sys.exit(1)
        
        # Get accounts from batch
        print(f"\nFetching accounts from batch {batch_id}...")
        accounts = get_accounts_from_batch(connection, batch_id)
        
        if not accounts:
            print("No accounts found in this batch.")
            return
        
        total_accounts = len(accounts)
        
        # Filter accounts if start_from_index is specified
        if start_from_index:
            if start_from_index < 1:
                print(f"Error: start_from_index must be >= 1 (got {start_from_index})")
                sys.exit(1)
            if start_from_index > total_accounts:
                print(f"Error: start_from_index ({start_from_index}) exceeds total accounts ({total_accounts})")
                sys.exit(1)
            accounts = accounts[start_from_index - 1:]
        
        # Extract dates from batch
        start_date = batch['start_date'].strftime('%Y-%m-%d') if batch['start_date'] else None
        end_date = batch['end_date'].strftime('%Y-%m-%d') if batch['end_date'] else None
        
        if not start_date or not end_date:
            print("Error: Batch does not have start_date and end_date set.")
            sys.exit(1)
        
        quarter = batch['quarter']
        year = batch['year']
        
        # Count existing PDFs if skip_existing is enabled
        existing_pdf_count = 0
        existing_pdf_details = {}  # Track where PDFs were found
        existing_pdfs_set = set()  # Set of account numbers with existing PDFs
        if skip_existing:
            print("\nChecking for existing PDFs...")
            print("Note: Checking local 'uploads' directory. If PDFs are on the server, ensure you're running this script on the server or use --uploads-dir to specify the server path.")
            
            # Build a set of all existing PDF account numbers for faster lookup
            # Only check the current quarter folder (not all quarters)
            quarter_folder_name = f"q{quarter}-{year}"
            quarter_path = Path(uploads_dir) / quarter_folder_name
            
            if quarter_path.exists() and quarter_path.is_dir():
                print(f"Scanning {quarter_folder_name} folder...")
                # Get all PDF files in the quarter folder
                pdf_files = list(quarter_path.glob("Statement_Q*.pdf"))
                print(f"Found {len(pdf_files)} PDF files in {quarter_folder_name}")
                
                # Extract account numbers from filenames
                # Pattern: Statement_Q{quarter}_{year}_{account}.pdf
                for pdf_file in pdf_files:
                    filename = pdf_file.stem  # Without .pdf extension
                    # Extract account number (everything after the last underscore)
                    parts = filename.split('_')
                    if len(parts) >= 4:  # Statement, Q{quarter}, {year}, {account}
                        account_from_file = parts[-1]
                        existing_pdfs_set.add(account_from_file)
                        existing_pdf_details[account_from_file] = quarter_folder_name
            else:
                print(f"Warning: {quarter_folder_name} folder does not exist yet.")
            
            print(f"Total unique accounts with existing PDFs in {quarter_folder_name}: {len(existing_pdfs_set)}")
            
            # Now check each account against the set
            for account_record in accounts:
                account = normalize_account(account_record.get('account_number', ''))
                if account:
                    # Sanitize account for comparison (same as filename)
                    sanitized_account = re.sub(r'[^a-zA-Z0-9_-]', '', account) or 'member'
                    
                    if sanitized_account in existing_pdfs_set:
                        existing_pdf_count += 1
        
        # Display summary
        print("\n" + "=" * 80)
        print("EXPORT SUMMARY")
        print("=" * 80)
        print(f"Batch ID: {batch_id}")
        print(f"Quarter: Q{quarter} {year}")
        print(f"Period: {start_date} to {end_date}")
        print(f"Total accounts in batch: {total_accounts}")
        print(f"Accounts to process: {len(accounts)}")
        if start_from_index:
            print(f"Starting from row: {start_from_index}")
        if skip_existing:
            print(f"Skip existing PDFs: Enabled")
            print(f"Existing PDFs found: {existing_pdf_count}")
            print(f"PDFs to generate: {len(accounts) - existing_pdf_count}")
            if existing_pdf_count > 0:
                # Show the quarter folder where PDFs were found
                quarter_folder_name = f"q{quarter}-{year}"
                print(f"\nExisting PDFs found in: {quarter_folder_name}")
        print(f"API URL: {API_BASE_URL}{API_ENDPOINT}")
        print("=" * 80)
        
        # Ask for confirmation
        confirmation = input("\nProceed with export? (Y/N): ").strip().upper()
        
        if confirmation != 'Y':
            print("Export cancelled.")
            return
        
        print("\n" + "-" * 80)
        print("Starting PDF export process...")
        print("-" * 80)
        
        # Process each account
        success_count = 0
        skipped_count = 0
        error_count = 0
        errors = []
        
        # Calculate starting index for display
        display_start_index = start_from_index if start_from_index else 1
        
        # Build existing PDFs set if skip_existing is enabled (reuse from earlier scan)
        # The existing_pdfs_set was already built above, we just need to reference it
        
        for index, account_record in enumerate(accounts, 1):
            # Calculate actual row number for display
            actual_row = display_start_index + index - 1
            
            # Decrypt account number
            account = normalize_account(account_record.get('account_number', ''))
            
            if not account:
                print(f"[Row {actual_row} / {total_accounts}] Skipping account with empty account number (ID: {account_record.get('id', 'unknown')})")
                error_count += 1
                continue
            
            # Check if PDF already exists (using pre-built set for speed)
            if skip_existing:
                sanitized_account = re.sub(r'[^a-zA-Z0-9_-]', '', account) or 'member'
                if sanitized_account in existing_pdfs_set:
                    quarter_info = ""
                    if sanitized_account in existing_pdf_details:
                        quarter_info = f" (found in {existing_pdf_details[sanitized_account]})"
                    print(f"[Row {actual_row} / {total_accounts}] Skipping account {account} (PDF already exists{quarter_info})")
                    skipped_count += 1
                    continue
            
            # Show progress
            print(f"[Row {actual_row} / {total_accounts}] Generating PDF for account: {account}...", end=" ", flush=True)
            
            # Generate PDF
            success, error_msg = generate_pdf_for_member(account, start_date, end_date, token)
            
            if success:
                print("✓ Success")
                success_count += 1
            else:
                print(f"✗ Failed: {error_msg}")
                error_count += 1
                errors.append({
                    'account': account,
                    'error': error_msg
                })
        
        # Summary
        print("-" * 80)
        print(f"\nExport completed!")
        print(f"Total accounts processed: {len(accounts)}")
        print(f"Successful: {success_count}")
        print(f"Skipped (existing): {skipped_count}")
        print(f"Failed: {error_count}")
        
        if errors:
            print(f"\nErrors encountered:")
            for error in errors[:10]:  # Show first 10 errors
                print(f"  - Account {error['account']}: {error['error']}")
            if len(errors) > 10:
                print(f"  ... and {len(errors) - 10} more errors")
    
    finally:
        if connection and connection.is_connected():
            connection.close()
            print("\nDatabase connection closed.")


def main():
    """Entry point for the script."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Export PDF statements for all accounts in a batch')
    parser.add_argument('--batch-id', type=str, help='Batch ID to process (if not provided, will list all batches)', default=None)
    parser.add_argument('--token', type=str, help='API authentication token', default=API_TOKEN)
    parser.add_argument('--start-from-index', type=int, help='Row number to start from (1-indexed, will skip all rows before this)', default=None)
    parser.add_argument('--skip-existing', action='store_true', help='Skip accounts that already have PDF files')
    parser.add_argument('--uploads-dir', type=str, help='Directory where PDFs are stored', default='uploads')
    
    args = parser.parse_args()
    
    export_statements_from_batch(
        batch_id=args.batch_id,
        token=args.token,
        start_from_index=args.start_from_index,
        skip_existing=args.skip_existing,
        uploads_dir=args.uploads_dir
    )


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Export Statement Service
Queries all members from the database and generates PDFs for each using the API.
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

# Default date range (Q3 2025)
DEFAULT_START_DATE = os.getenv('START_DATE', '2025-07-01')
DEFAULT_END_DATE = os.getenv('END_DATE', '2025-09-30')


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


def get_all_members(connection) -> List[Dict]:
    """Query all members from the database."""
    try:
        cursor = connection.cursor(dictionary=True)
        query = "SELECT * FROM members ORDER BY account_number ASC"
        cursor.execute(query)
        members = cursor.fetchall()
        cursor.close()
        return members
    except Error as e:
        print(f"Error querying members: {e}")
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
    """Normalize account number (remove spaces, convert to string, decrypt if needed)."""
    if account is None:
        return ""
    
    # First decrypt if encrypted
    decrypted = decrypt_account(str(account))
    
    # Then normalize
    return decrypted.strip().replace(" ", "")


def get_quarter_from_date(date_str: str) -> tuple:
    """
    Determine quarter number from a date string.
    Q1: Jan-Mar (months 1-3)
    Q2: Apr-Jun (months 4-6)
    Q3: Jul-Sep (months 7-9)
    Q4: Oct-Dec (months 10-12)
    Returns (quarter, year)
    """
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        month = date_obj.month
        year = date_obj.year
        
        if month >= 1 and month <= 3:
            quarter = 1
        elif month >= 4 and month <= 6:
            quarter = 2
        elif month >= 7 and month <= 9:
            quarter = 3
        else:
            quarter = 4
        
        return quarter, year
    except Exception:
        # Default to Q3 2025 if parsing fails
        return 3, 2025


def get_expected_pdf_path(account: str, start_date: str, uploads_dir: str = 'uploads') -> Path:
    """
    Get the expected PDF file path for an account.
    Returns Path object for the expected file location.
    """
    quarter, year = get_quarter_from_date(start_date)
    quarter_folder = f"q{quarter}-{year}"
    
    # Sanitize account number (same as API does: replace(/[^a-zA-Z0-9_-]/g, ''))
    sanitized_account = re.sub(r'[^a-zA-Z0-9_-]', '', account) or 'member'
    
    filename = f"Statement_Q{quarter}_{year}_{sanitized_account}.pdf"
    return Path(uploads_dir) / quarter_folder / filename


def pdf_exists(account: str, start_date: str, uploads_dir: str = 'uploads') -> bool:
    """
    Check if PDF file already exists for an account.
    Returns True if file exists, False otherwise.
    """
    pdf_path = get_expected_pdf_path(account, start_date, uploads_dir)
    return pdf_path.exists() and pdf_path.is_file()


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


def export_statements(start_date: str = None, end_date: str = None, token: str = None, 
                      start_from_account: str = None, skip_existing: bool = False,
                      uploads_dir: str = 'uploads'):
    """
    Main function to export statements for all members.
    
    Args:
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        token: API authentication token
        start_from_account: Account number to start from (will skip all accounts before this)
        skip_existing: If True, skip accounts that already have PDF files
        uploads_dir: Directory where PDFs are stored (default: 'uploads')
    """
    # Use defaults if not provided
    start_date = start_date or DEFAULT_START_DATE
    end_date = end_date or DEFAULT_END_DATE
    token = token or API_TOKEN
    
    if not token:
        print("Error: API token is required. Set QUARTERLY_PDF_API_TOKEN environment variable or pass as argument.")
        sys.exit(1)
    
    print(f"Starting PDF export process...")
    print(f"Date range: {start_date} to {end_date}")
    print(f"API URL: {API_BASE_URL}{API_ENDPOINT}")
    if start_from_account:
        print(f"Starting from account: {start_from_account}")
    if skip_existing:
        print(f"Skipping existing PDF files: Enabled")
    print("-" * 60)
    
    # Connect to database
    print("Connecting to database...")
    connection = get_db_connection()
    
    try:
        # Get all members
        print("Fetching all members from database...")
        members = get_all_members(connection)
        total_members = len(members)
        
        if total_members == 0:
            print("No members found in database.")
            return
        
        # Filter members if start_from_account is specified
        if start_from_account:
            start_account_normalized = normalize_account(start_from_account)
            filtered_members = []
            start_found = False
            
            for member in members:
                account = normalize_account(member.get('account_number', ''))
                if not start_found:
                    # Try to match by account number (numeric comparison if both are numeric)
                    try:
                        # If both are numeric, compare as numbers
                        if account.isdigit() and start_account_normalized.isdigit():
                            if int(account) >= int(start_account_normalized):
                                start_found = True
                                filtered_members.append(member)
                        # Otherwise, compare as strings
                        elif account >= start_account_normalized:
                            start_found = True
                            filtered_members.append(member)
                    except:
                        # Fallback to string comparison
                        if account >= start_account_normalized:
                            start_found = True
                            filtered_members.append(member)
                else:
                    filtered_members.append(member)
            
            members = filtered_members
            print(f"Filtered to {len(members)} members starting from account {start_from_account}")
        
        if len(members) == 0:
            print("No members to process after filtering.")
            return
        
        print(f"Found {len(members)} members to process (out of {total_members} total).")
        print("-" * 60)
        
        # Process each member
        success_count = 0
        skipped_count = 0
        error_count = 0
        errors = []
        
        for index, member in enumerate(members, 1):
            account = normalize_account(member.get('account_number', ''))
            
            if not account:
                print(f"[{index}/{len(members)}] Skipping member with empty account number (ID: {member.get('id', 'unknown')})")
                error_count += 1
                continue
            
            # Check if PDF already exists
            if skip_existing and pdf_exists(account, start_date, uploads_dir):
                print(f"[{index}/{len(members)}] Skipping account {account} (PDF already exists)")
                skipped_count += 1
                continue
            
            # Show progress
            print(f"[{index}/{len(members)}] Generating PDF for account: {account}...", end=" ", flush=True)
            
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
        print("-" * 60)
        print(f"\nExport completed!")
        print(f"Total members processed: {len(members)}")
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
    
    parser = argparse.ArgumentParser(description='Export PDF statements for all members')
    parser.add_argument('--start-date', type=str, help='Start date (YYYY-MM-DD)', default=DEFAULT_START_DATE)
    parser.add_argument('--end-date', type=str, help='End date (YYYY-MM-DD)', default=DEFAULT_END_DATE)
    parser.add_argument('--token', type=str, help='API authentication token', default=API_TOKEN)
    parser.add_argument('--start-from-account', type=str, help='Account number to start from (will skip all accounts before this)', default=None)
    parser.add_argument('--skip-existing', action='store_true', help='Skip accounts that already have PDF files')
    parser.add_argument('--uploads-dir', type=str, help='Directory where PDFs are stored', default='uploads')
    
    args = parser.parse_args()
    
    export_statements(
        start_date=args.start_date,
        end_date=args.end_date,
        token=args.token,
        start_from_account=args.start_from_account,
        skip_existing=args.skip_existing,
        uploads_dir=args.uploads_dir
    )


if __name__ == "__main__":
    main()


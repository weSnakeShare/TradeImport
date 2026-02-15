import os
import glob
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from typing import List
from datetime import datetime
from parsers import get_parser, PARSERS, SchwabParser, IBParser, Trading212Parser
from trade_models import TradeRecord

# Configuration
TRADE_DIR = '../TradeFiles'
CREDENTIALS_FILE = 'credentials.json'
SPREADSHEET_NAME_OR_ID = None # Takes first argument or user input if strictly needed, but let's try to find it or ask.
# Ideally we ask the user for the ID once and store it, or just edit this file.
# For now, we will ask for input if not found in a config.


# account map for testing at MNOPLeung
# ACCOUNT_MAP = {
#     'Individual': 'CSlsy',
#     'U10531644': 'IBlsy',
#     'from_': 'T212lsy'
# }


# account map for production idata
ACCOUNT_MAP = {
    'Individual': 'aaa',  #CS
    'U10531644': 'lsyIB', #IB
    'from_': 'T212lsy'    #T212
}



def get_sheet_service():
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"[{datetime.now()}] Warning: {CREDENTIALS_FILE} not found. Running in DRY RUN mode (no upload).")
        return None
    
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_FILE, scope)
    client = gspread.authorize(creds)
    return client

def main():
    print(f"[{datetime.now()}] Starting Trade ETL...")
    
    # 1. Gather all files
    all_files = []
    for ext in ['*.csv']:
        all_files.extend(glob.glob(os.path.join(TRADE_DIR, ext)))
    
    if not all_files:
        print(f"No trade files found in {TRADE_DIR}")
        return

    all_trades: List[TradeRecord] = []
    seen_trades = set()

    # 2. Parse Files
    for file_path in all_files:
        filename = os.path.basename(file_path)
        
        # Determine Parser
        parser = None
        if 'Individual' in filename:
            parser = SchwabParser()
        elif 'TRANSACTIONS' in filename:
            parser = IBParser()
        elif filename.startswith('from_'):
            parser = Trading212Parser()
        
        if not parser:
            print(f"Skipping unknown file format: {filename}")
            continue
            
        print(f"Parsing {filename}...")
        try:
            trades = list(parser.parse(file_path, ACCOUNT_MAP))
            print(f"  -> Found {len(trades)} trades.")
            print(f"  -> Found {len(trades)} trades.")
            
            # Deduplication
            for t in trades:
                # Key: Date|Account|Symbol|Side|Qty|Price (Ignore SourceFile or Fees which might vary slightly?)
                # Price/Qty should be robust.
                unique_key = f"{t.date}|{t.account_name}|{t.symbol}|{t.side}|{t.quantity}|{t.price}"
                
                if unique_key not in seen_trades:
                    seen_trades.add(unique_key)
                    all_trades.append(t)
                else:
                    # Optional: Print verbose if debugging
                    # print(f"    [Skip Duplicate] {t.symbol} {t.side} {t.quantity} on {t.date}")
                    pass
        except Exception as e:
            print(f"  -> Error parsing {filename}: {e}")

    if not all_trades:
        print("No trades extracted.")
        return

    # 3. Sort Trades
    # Sort by Date (asc), then by Side (BUY first, then SELL, so Buys are processed before Sells on the same second)
    # Side: BUY < SELL alphabetically? B < S. So ascending order works.
    all_trades.sort(key=lambda t: (t.date, t.side))

    print(f"Total trades to process: {len(all_trades)}")

    # 4. Upload to Google Sheets
    client = get_sheet_service()
    if not client:
        print("Dry Run: First 5 rows that would be uploaded:")
        for t in all_trades[:5]:
            print(t.to_row())
        return

    # Ask for Sheet ID if not hardcoded
    sheet_id = input("Enter Google Spreadsheet ID (or press Enter if defined in code): ").strip()
    if not sheet_id:
        print("Error: No Sheet ID provided.")
        return

    try:
        sheet = client.open_by_key(sheet_id)
        
        # Ensure "Raw Imports" tab exists
        try:
            worksheet = sheet.worksheet("Raw Imports")
        except gspread.WorksheetNotFound:
            print("Creating 'Raw Imports' tab...")
            worksheet = sheet.add_worksheet(title="Raw Imports", rows=1000, cols=10)
            worksheet.append_row([
                "Date", "Account", "Symbol", "Side", "Qty", "Price", "Fees", "Currency", "SourceFile"
            ])

        # Prepare payload
        rows = [t.to_row() for t in all_trades]
        
        # Append? Or Clear and Replace?
        # User said "The trades imported... should be matched". 
        # Usually importers append new ones. But since we are reading ALL files in the directory,
        # we probably are reprocessing everything. 
        # For safety in this simpler version, let's CLEAR and REPLACE to avoid duplicates if the user keeps old files.
        # Or, we strictly append.
        # Given "read from trade files... import records", if I run it twice, do I want duplicates?
        # Let's Clear and Replace for now to ensure consistency, assuming the local folder has the "Source of Truth".
        
        print("Clearing existing data in 'Raw Imports'...")
        worksheet.clear()
        worksheet.append_row([
            "Date", "Account", "Symbol", "Side", "Qty", "Price", "Fees", "Currency", "SourceFile"
        ])
        
        print(f"Uploading {len(rows)} rows...")
        # Chunk upload if necessary, but gspread handles lists well.
        worksheet.append_rows(rows, value_input_option='USER_ENTERED')
        
        print("Upload Complete.")
        
    except Exception as e:
        print(f"Google Sheets Error: {e}")

if __name__ == "__main__":
    main()

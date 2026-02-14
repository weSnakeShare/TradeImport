import csv
import os
from datetime import datetime
from typing import List, Generator, Optional
from trade_models import TradeRecord

class BaseParser:
    def parse(self, file_path: str, account_map: dict) -> Generator[TradeRecord, None, None]:
        raise NotImplementedError

class SchwabParser(BaseParser):
    def parse(self, file_path: str, account_map: dict) -> Generator[TradeRecord, None, None]:
        account_name = "Unknown"
        filename = os.path.basename(file_path)
        for key, value in account_map.items():
            if key in filename:
                account_name = value
                break
        
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    action = row.get('Action', '').strip()
                    if action not in ['Buy', 'Sell']:
                        continue
                    
                    date_str = row['Date'] # Format: 12/30/2025
                    try:
                        dt = datetime.strptime(date_str, '%m/%d/%Y')
                    except ValueError:
                         # Try fallback formats if needed, or log error
                        print(f"Skipping row with invalid date: {date_str}")
                        continue

                    # Quantity often has separators? Schwab usually creates clean CSVs but let's be safe
                    qty = float(row['Quantity'].replace(',', ''))
                    price_str = row['Price'].replace('$', '').replace(',', '')
                    price = float(price_str)
                    
                    # Fees & Comm
                    fees_str = row.get('Fees & Comm', '').replace('$', '').replace(',', '')
                    fees = float(fees_str) if fees_str else 0.0

                    symbol = row['Symbol']
                    
                    yield TradeRecord(
                        date=dt,
                        account_name=account_name,
                        symbol=symbol,
                        side=action.upper(),
                        quantity=qty,
                        price=price,
                        fees=fees,
                        original_currency='USD', # Schwab export usually implies USD for US stocks
                        source_file=filename,
                        raw_data=row
                    )
                except Exception as e:
                    print(f"Error parsing row in {filename}: {e}")

class IBParser(BaseParser):
    def parse(self, file_path: str, account_map: dict) -> Generator[TradeRecord, None, None]:
        # IB CSVs are multi-section. We need to find "Transaction History".
        # Section header: "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount"
        
        account_name = "Unknown"
        filename = os.path.basename(file_path)
        for key, value in account_map.items():
            if key in filename:
                account_name = value
                break

        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Locate the header for Transaction History
        header_index = -1
        headers = []
        for i, line in enumerate(lines):
            if line.startswith('Transaction History,Header'):
                headers = line.strip().split(',')
                header_index = i
                break
        
        if header_index == -1:
            print(f"Could not find 'Transaction History' section in {filename}")
            return

        # Map column names to indices
        try:
            col_map = {name.strip(): idx for idx, name in enumerate(headers)}
            idx_date = col_map['Date']
            idx_type = col_map['Transaction Type'] # "Buy" or "Sell" matches? IB uses "Buy"/"Sell"
            idx_symbol = col_map['Symbol']
            idx_qty = col_map['Quantity']
            idx_price = col_map['Price']
            idx_curr = col_map['Price Currency']
            idx_comm = col_map['Commission']
        except KeyError as e:
            print(f"Missing expected column in IB file: {e}")
            return

        for i in range(header_index + 1, len(lines)):
            line = lines[i]
            if not line.startswith('Transaction History,Data'):
                continue
            
            parts = line.strip().split(',')
            # Basic CSV splitting might fail on quoted fields with commas. 
            # Ideally use csv module, but IB format is tricky with the prefix.
            # Let's try to reload strictly the data lines if we want robustness, 
            # bit splitting by comma usually works for IB unless descriptions satisfy it.
            # Better approach: Use csv.reader on the single line
            
            reader = csv.reader([line])
            row_list = list(reader)[0]
            
            # Check length matches headers roughly
            if len(row_list) < len(headers):
                continue
            
            trans_type = row_list[idx_type]
            if trans_type not in ['Buy', 'Sell']:
                continue
            
            try:
                date_str = row_list[idx_date] # Format: 2026-02-12
                dt = datetime.strptime(date_str, '%Y-%m-%d')
                
                qty = float(row_list[idx_qty].replace(',', ''))
                # Sell quantity in IB is negative. We should normalize to positive for the core logic?
                # The user wants "Sell". Usually matching logic expects positive Qty for both, just 'Side' differs.
                # Let's store absolute quantity.
                qty = abs(qty)
                
                price = float(row_list[idx_price].replace(',', ''))
                curr = row_list[idx_curr]
                comm = float(row_list[idx_comm].replace(',', '')) if row_list[idx_comm] and row_list[idx_comm] != '-' else 0.0
                # Commission in IB is usually negative. We typically want positive magnitude for cost.
                comm = abs(comm)

                symbol = row_list[idx_symbol]

                yield TradeRecord(
                    date=dt,
                    account_name=account_name,
                    symbol=symbol,
                    side=trans_type.upper(),
                    quantity=qty,
                    price=price,
                    fees=comm,
                    original_currency=curr,
                    source_file=filename,
                    raw_data={'line': line}
                )
            except Exception as e:
                print(f"Error parsing IB row: {e}")

class Trading212Parser(BaseParser):
    def parse(self, file_path: str, account_map: dict) -> Generator[TradeRecord, None, None]:
        account_name = "Unknown"
        filename = os.path.basename(file_path)
        for key, value in account_map.items():
            if key in filename:
                account_name = value
                break
        
        with open(file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    # Action: "Limit buy", "Market sell", etc.
                    action_raw = row['Action']
                    if 'buy' in action_raw.lower():
                        side = 'BUY'
                    elif 'sell' in action_raw.lower():
                        side = 'SELL'
                    else:
                        continue
                    
                    # Time: 2026-01-29 16:05:53
                    date_str = row['Time']
                    dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                    
                    symbol = row['Ticker']
                    qty = float(row['No. of shares'])
                    price = float(row['Price / share'])
                    curr = row['Currency (Price / share)']
                    
                    # T212 might have conversion fees or other fees. 
                    # "Currency conversion fee" field exists.
                    # "Total" field exists.
                    # Let's just grab conversion fee as 'fees' for now if in same currency?
                    # Or maybe just 0 if not explicit commission column? 
                    # The file has "Currency conversion fee".
                    # T212 Fees: "Currency conversion fee", "Stamp duty", "Stamp duty reserve tax"
                    fee_conv = float(row.get('Currency conversion fee', '0') or 0.0)
                    fee_stamp = float(row.get('Stamp duty', '0') or 0.0)
                    fee_stamp_reserve = float(row.get('Stamp duty reserve tax', '0') or 0.0)
                    
                    fees = fee_conv + fee_stamp + fee_stamp_reserve

                    yield TradeRecord(
                        date=dt,
                        account_name=account_name,
                        symbol=symbol,
                        side=side,
                        quantity=qty,
                        price=price,
                        fees=fees,
                        original_currency=curr,
                        source_file=filename,
                        raw_data=row
                    )

                except Exception as e:
                    print(f"Error parsing T212 row: {e}")

PARSERS = {
    'Individual': SchwabParser(),
    'TRANSACTIONS': IBParser(),
    'from_': Trading212Parser()
}

def get_parser(filename: str) -> Optional[BaseParser]:
    for key, parser in PARSERS.items():
        if key in filename:
            return parser
    return None

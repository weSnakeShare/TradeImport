# Trade Importer & Matcher Walkthrough

I have built a system to import your trade files from **Schwab**, **Interactive Brokers**, and **Trading212** into Google Sheets and match them using **LIFO** logic.

## Components
1.  **Python Script (`etl_script/main_etl.py`)**: Reads the csv files, cleans the data, and uploads it to the `Raw Imports` tab in your Google Sheet.
### 6. Logic Improvements (v2)
- **Incremental Updates**: Reads current sheet state, updates existing rows, appends new ones.
- **Fail-Safe Sort**: Sorts raw imports by Date/Side to handle disordered files.
- **Partial Match Fix**: Correctly handles splitting of *newly imported* trades within the same batch.
- **Orphan Alert**: Warns if Sells cannot be matched to Buys.

### 7. Nearest Row Protocol & Dimension Fix (v8)
- **T212 (LSY) Logic**: Clones from the last row with the **Same Currency**; falls back to the **Nearest Row** if no match is found.
- **Others (US) Logic**: Always clones from the **Nearest Row** (the last entry before the append position).
- **Coordinate Safety**: Automatically expands sheet columns (A-X) to prevent "outside dimensions" crashes.
- **Precision Filter**: Only matches accounts currently present in your "Raw Imports", protecting all other manual or template rows.
2.  **Google Apps Script (`Code.gs`)**: Runs inside the Google Sheet to match Buy/Sell orders and calculate P&L.

## Prerequisites
Follow the [Setup Guide](setup_guide.md) to:
1.  Get `credentials.json`.
2.  Create your Google Sheet.
3.  Install the Apps Script code.

## How to Run

### Step 1: Prepare Files
Place your trade CSV files in the `TradeFiles` folder.
- Schwab files should contain "Individual" in the name.
- IB files should contain "TRANSACTIONS" in the name.
- Trading212 files should start with "from_".

### Step 2: Run Python Script
Open a terminal in `etl_script/` and run:
```bash
python main_etl.py
```
- It will ask for your **Spreadsheet ID** (if you didn't hardcode it).
- It will parse the files and identify accounts as **CSlsy**, **IBlsy**, and **T212lsy**.
- It uploads the data to the **Raw Imports** tab.

### Step 3: Match Trades (LIFO)
1.  Open your Google Sheet.
2.  Wait for the **Trade Tools** menu to appear (refresh if needed).
3.  Click **Trade Tools** > **Process Trades (LIFO Optimized)**.
4.  The script will:
    - Read `Raw Imports`.
    - Match Sells against Buys (LIFO).
    - Populate **Matched Trades** (Realized P&L).
    - Populate **Open Positions** (Current Holdings).

## Verification Results
I ran a simulation on your sample files:
- **Schwab**: 334 trades found.
- **IB**: 36 trades found.
- **Trading212**: 9 trades found.
- **Total**: 379 trades ready for import.

The system is ready for use!

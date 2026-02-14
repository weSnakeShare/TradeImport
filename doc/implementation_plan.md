# Trade Importer and Matcher System Design

## Goal
A robust workflow to import trade files (IB, Schwab, T212), standardize them, and perform **LIFO (Last-In-First-Out)** matching in Google Sheets to calculate Realized P&L and Open Positions.

## User Requirements (Implemented)
1.  **Support Multiple Brokers**:
    - **Schwab** (`Individual_*.csv` -> Account `CSlsy`)
    - **Interactive Brokers** (`U10531644.TRANSACTIONS...csv` -> Account `IBlsy`)
    - **Trading212** (`from_*.csv` -> Account `T212lsy`)
2.  **Incremental Processing**: Append new trades without deleting existing history or manual notes in the sheet.
3.  **Multi-Sheet Output**:
    - **T212** trades go to `ProcessedTrade2`.
    - **Other** trades go to `SampleTrades` (default).
4.  **Smart Formatting**:
    - New rows must inherit formulas/formats from existing rows.
    - **T212**: Clone format from the last row with the **Same Currency**.
    - **Others**: Clone format from the **Last Row** of the sheet.
5.  **Deduplication**: Prevent duplicate imports if source files overlap (handled in Python).

## System Architecture

### 1. Python ETL (`etl_script/main_etl.py`)
- **Parsers**: Custom parsers for each broker format.
- **Normalization**: Standardizes all trades to: `Date | Account | Symbol | Side | Qty | Price | Fees | Currency`.
- **Fee Handling**: Aggregates commissions (e.g., T212 includes "Stamp Duty" + "Conversion Fee").
- **Deduplication**: Filters out duplicate trades based on `Date|Account|Symbol|Side|Qty|Price` signature.
- **Upload**: Clears and overwrites the `Raw Imports` tab in Google Sheets with the clean dataset.

### 2. Google Sheets Logic (`Code.gs`)
The "Brain" of the operation. Runs via "Trade Tools > Process Trades".

#### Core Logic (LIFO Matcher)
1.  **Load State**: Reads **Open Positions** from *both* `SampleTrades` and `ProcessedTrade2` into a unified memory.
2.  **Read New Trades**: Reads `Raw Imports`, sorts by **Date Ascending** (Buy before Sell).
3.  **Match**: Iterates through new trades:
    - **Buy**: Adds to the LIFO stack. Appends a new "Open" row to the correct sheet.
    - **Sell**: Pops the last matching "Buy" from the stack.
        - **Full Match**: Marks the existing "Open" row as Closed (updates Sell Date/Price/Comm).
        - **Partial Match**: Splits the existing row (updates it to 'Matched' qty) and appends a **New Remainder Row** for the unsold portion.
    - **Orphan Sell**: If no Buy is found, appends the Sell as "MISSING_BUY" (Warning).

#### Output Logic
- **Routing**: Sends T212 trades to `ProcessedTrade2`, others to `SampleTrades`.
- **Formatting**:
    - Uses **Bulk Operations** to clone formulas/formats from template rows.
    - Ensures performance by grouping writes by currency/sheet.

## Setup & Usage
See [Setup Guide](setup_guide.md) and [Walkthrough](walkthrough.md) for detailed instructions.

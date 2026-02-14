# Google Sheets Setup Guide

To run the Python script, you need two things:
1.  **credentials.json**: A key file that allows the script to "log in" as a Service Account.
2.  **Spreadsheet ID**: The unique ID of the Google Sheet you want to write to.

## Part 1: Get `credentials.json` (Service Account)

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  **Create a New Project**:
    *   Click the project dropdown (top left).
    *   Click **New Project**.
    *   Name it `TradeImporter` and click **Create**.
3.  **Enable Sheets API**:
    *   In the search bar (top), type "Google Sheets API".
    *   Click **Google Sheets API** (Marketplace).
    *   Click **Enable**.
4.  **Create Service Account**:
    *   Go to **IAM & Admin** > **Service Accounts** (left menu).
    *   Click **+ CREATE SERVICE ACCOUNT**.
    *   Name: `trade-bot`.
    *   Click **Create and Continue**.
    *   **Role**: Select `Editor` (Basic > Editor). This gives it permission to edit sheets.
    *   Click **Done**.
5.  **Download Key**:
    *   Click on the email address of the service account you just created (e.g., `trade-bot@...`).
    *   Go to the **KEYS** tab.
    *   Click **ADD KEY** > **Create new key**.
    *   Select **JSON** and click **CREATE**.
    *   A file will download. **Rename this file to `credentials.json`** and place it in the same folder as the script.

## Part 2: Create Sheet & Get ID

1.  Go to [sheets.google.com](https://sheets.google.com) and create a **Blank** spreadsheet.
2.  **Get the ID**:
    *   Look at the URL in your browser address bar. It looks like this:
    *   `https://docs.google.com/spreadsheets/d/`**`1BxiMVs0XRA5nFMdKbBdBTu7...`**`/edit`
    *   The long string of random characters between `/d/` and `/edit` is your **Spreadsheet ID**.
3.  **Share with Service Account**:
    *   Open your `credentials.json` file (text editor) and find the `"client_email"` field.
    *   Copy that email address (e.g., `trade-bot@tradeimporter-123.iam.gserviceaccount.com`).
    *   In your Google Sheet, click the big **Share** button (top right).
    *   Paste the service account email and set it as **Editor**.
    *   Click **Send** (uncheck "Notify people" if you want).

## Part 3: Install Apps Script (The Matcher)

I will provide a file called `Code.gs`. Use it here:
1.  In your Google Sheet, click **Extensions** > **Apps Script**.
2.  Delete any code in the editor.
3.  Paste the contents of `Code.gs`.
4.  Click **Save** (Floppy disk icon).
5.  Reload your Google Sheet. You should see a custom menu called "Trade Tools" (after a few seconds).

/**
 * Trade Matcher (LIFO) - Version 8 (Nearest Row Protocol)
 * 
 * Logic Highlights:
 * 1. Strict Account Match: Only loads portfolio data for accounts found in Raw Imports today.
 * 2. Nearest Row Cloning: Always uses the row immediately preceding the append location for formatting/formulas.
 * 3. Multi-Currency: For LSY, it still tries to find a matching currency but falls back to the Nearest Row.
 * 4. Coordinate Safety: Dynamically expands sheet columns and checks range bounds.
 */

const CONFIG = {
  RAW_IMPORTS_SHEET: 'Raw Imports',
  SHEET_MAP: {
    'T212lsy': 'LSY',     
    'DEFAULT': 'US'       
  },
  MULTI_CURRENCY_SHEETS: ['LSY'], // These sheets use currency matchmaking first
  HEADER_ROWS: 1,
  CLONE_COL_COUNT: 24             // We clone columns A through X
};

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Trade Tools')
      .addItem('Process Trades (LIFO Optimized)', 'processTrades')
      .addToUi();
}

/**
 * Identify the data block and existing accounts on a sheet.
 */
function getSheetStats(sheet, activeAccounts) {
  const lastRowSheet = sheet.getLastRow();
  if (lastRowSheet <= CONFIG.HEADER_ROWS) return { startRow: null, lastRow: lastRowSheet, portfolio: [] };

  const data = sheet.getRange(1, 1, lastRowSheet, 17).getValues();
  let startRow = null; 
  let endRow = null;
  let matches = [];

  // Identify the continuous block of real data starting after headers
  for (let i = CONFIG.HEADER_ROWS; i < data.length; i++) {
    let row = data[i];
    let stock = (row[0] || "").toString().trim();
    let ac = (row[7] || "").toString().trim();
    let sDate = row[2];

    // Detect first real data row
    if (stock !== "" && activeAccounts.includes(ac)) {
      if (startRow === null) startRow = i + 1;
      endRow = i + 1;

      // Only load if not sold
      let isSold = (sDate && sDate.toString().trim() !== "");
      if (!isSold) {
        matches.push({
          rowNum: i + 1, stock: stock, bDate: row[1],
          qty: parseFloat(row[3]), bPrice: parseFloat(row[4]),
          bComm: parseFloat(row[15]) || 0, ac: ac, currency: row[16]
        });
      }
    } else if (stock === "" && startRow !== null) {
      // End of continuous data block
      break; 
    }
  }

  return {
    startRow: startRow,
    lastRow: endRow || lastRowSheet, // 'Nearest row' will be lastRow
    portfolio: matches
  };
}

function processTrades() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ss.getSheetByName(CONFIG.RAW_IMPORTS_SHEET);
  if (!rawSheet) {
    Browser.msgBox(`Error: Missing '${CONFIG.RAW_IMPORTS_SHEET}' sheet.`);
    return;
  }

  const rawData = rawSheet.getDataRange().getValues();
  if (rawData.length <= 1) {
    Browser.msgBox("Raw Imports is empty.");
    return; 
  }

  const newTradesSource = rawData.slice(1);
  const activeAccounts = [...new Set(newTradesSource.map(r => r[1].toString().trim()))];
  const outputSheetNames = [...new Set(Object.values(CONFIG.SHEET_MAP))];

  // 1. Initialize Sheets and Load Stats
  let sheets = {};
  let sheetStats = {};
  let portfolio = {}; 

  outputSheetNames.forEach(name => {
    let s = ss.getSheetByName(name) || ss.insertSheet(name);
    if (s.getLastRow() === 0) {
      s.appendRow(['Stock','B date','S date','Qty','BPrice','SPrice','','a/c','','','','','','','','Commission','Currency']); 
    }
    // Ensure sufficient columns for cloning
    if (s.getMaxColumns() < CONFIG.CLONE_COL_COUNT) {
      s.insertColumnsAfter(s.getMaxColumns(), CONFIG.CLONE_COL_COUNT - s.getMaxColumns());
    }
    sheets[name] = s;
    
    let stats = getSheetStats(s, activeAccounts);
    sheetStats[name] = stats;
    
    // Group portfolio by account|stock
    stats.portfolio.forEach(p => {
      let key = p.ac + "|" + p.stock;
      if (!portfolio[key]) portfolio[key] = [];
      p.sheetName = name;
      portfolio[key].push(p);
    });
  });

  // 2. Processing Logic
  newTradesSource.sort((a, b) => { // Date Asc, Buy then Sell
     let dateA = new Date(a[0]), dateB = new Date(b[0]);
     if (dateA != dateB) return dateA - dateB;
     return (a[3].toUpperCase() === 'BUY' ? -1 : 1);
  });

  let rowsToAppend = {};
  outputSheetNames.forEach(name => rowsToAppend[name] = []);
  let updates = []; 
  let orphanedSells = 0;
  const EPSILON = 0.000000001;

  newTradesSource.forEach(row => {
    let dateStr = row[0] instanceof Date ? Utilities.formatDate(row[0], ss.getSpreadsheetTimeZone(), "yyyy-MM-dd") : row[0];
    let account = row[1].toString().trim(), symbol = row[2].toString().trim(), side = row[3].toString().toUpperCase().trim();
    let qty = parseFloat(row[4]), price = parseFloat(row[5]), fees = parseFloat(row[6]) || 0, currency = row[7].toString().trim();

    if (!qty || isNaN(qty)) return;
    let key = account + "|" + symbol;
    if (!portfolio[key]) portfolio[key] = [];
    let targetSheet = CONFIG.SHEET_MAP[account] || CONFIG.SHEET_MAP['DEFAULT'];

    if (side === 'BUY') {
      let lot = { sheetName: targetSheet, rowNum: null, stock: symbol, bDate: dateStr, qty: qty, bPrice: price, bComm: fees, ac: account, currency: currency };
      portfolio[key].push(lot);
      rowsToAppend[targetSheet].push(lot);
    } else {
      let rem = qty;
      while (rem > EPSILON) {
        if (portfolio[key].length === 0) {
          orphanedSells++;
          rowsToAppend[targetSheet].push({ sheetName: targetSheet, rowNum: null, stock: symbol, bDate: "MISSING_BUY", sDate: dateStr, qty: rem, bPrice: 0, sPrice: price, comm: (rem/qty)*fees, ac: account, currency: currency });
          break;
        }
        let buyLot = portfolio[key][portfolio[key].length - 1];
        let matchQty = Math.min(rem, buyLot.qty);
        let matchSellComm = (matchQty / qty) * fees;
        let matchBuyComm = (matchQty / buyLot.qty) * buyLot.bComm;
        let isSplit = (buyLot.qty - matchQty > EPSILON);

        if (buyLot.rowNum) {
          updates.push({s: buyLot.sheetName, r: buyLot.rowNum, c: 3, v: dateStr}, {s: buyLot.sheetName, r: buyLot.rowNum, c: 6, v: price});
          if (isSplit) {
            updates.push({s: buyLot.sheetName, r: buyLot.rowNum, c: 4, v: matchQty}, {s: buyLot.sheetName, r: buyLot.rowNum, c: 16, v: matchBuyComm + matchSellComm});
            let remLot = { sheetName: buyLot.sheetName, rowNum: null, stock: buyLot.stock, bDate: buyLot.bDate, qty: buyLot.qty - matchQty, bPrice: buyLot.bPrice, bComm: buyLot.bComm - matchBuyComm, ac: buyLot.ac, currency: buyLot.currency };
            rowsToAppend[buyLot.sheetName].push(remLot);
            portfolio[key][portfolio[key].length - 1] = remLot;
          } else {
            updates.push({s: buyLot.sheetName, r: buyLot.rowNum, c: 16, v: buyLot.bComm + matchSellComm});
            portfolio[key].pop();
          }
        } else {
          buyLot.sDate = dateStr; buyLot.sPrice = price;
          if (isSplit) {
            let origQty = buyLot.qty, origComm = buyLot.bComm;
            buyLot.qty = matchQty; buyLot.comm = matchBuyComm + matchSellComm;
            let remLot = { sheetName: buyLot.sheetName, rowNum: null, stock: buyLot.stock, bDate: buyLot.bDate, qty: origQty - matchQty, bPrice: buyLot.bPrice, bComm: origComm - matchBuyComm, ac: buyLot.ac, currency: buyLot.currency };
            rowsToAppend[buyLot.sheetName].push(remLot);
            portfolio[key][portfolio[key].length - 1] = remLot;
          } else {
            buyLot.comm = buyLot.bComm + matchSellComm;
            portfolio[key].pop();
          }
        }
        rem -= matchQty;
      }
    }
  });

  // 3. Commit Updates
  updates.forEach(u => sheets[u.s].getRange(u.r, u.c).setValue(u.v));

  // 4. Batch Appends with Nearest Row Cloning
  Object.keys(rowsToAppend).forEach(name => {
    let newRows = rowsToAppend[name];
    if (newRows.length === 0) return;

    let sheet = sheets[name], stats = sheetStats[name];
    let startAppendRow = stats.lastRow + 1;
    let nearestRow = stats.lastRow; // This is the "Nearest Row" (last row of data block)

    // Build Secondary Currency Map for Smart Cloning if applicable
    let currencyRowMap = {};
    if (CONFIG.MULTI_CURRENCY_SHEETS.includes(name)) {
      let cData = sheet.getRange(1, 17, stats.lastRow, 1).getValues();
      for (let i = cData.length - 1; i >= 0; i--) {
        let c = (cData[i][0] || "").toString().trim();
        if (c && !currencyRowMap[c]) currencyRowMap[c] = i + 1;
      }
      newRows.sort((a,b) => (a.currency||"").localeCompare(b.currency||""));
    }

    let outputValues = newRows.map(r => {
      let row = new Array(24).fill("");
      row[0]=r.stock; row[1]=r.bDate; row[2]=r.sDate||""; row[3]=r.qty; row[4]=r.bPrice; row[5]=r.sPrice||""; row[7]=r.ac; row[15]=r.comm!==undefined?r.comm:r.bComm; row[16]=r.currency||"";
      return row;
    });

    // Bulk Copy Formatting
    let blockStartIdx = 0;
    for (let i = 0; i < newRows.length; i++) {
      let curr = newRows[i].currency || "";
      let isLast = (i === newRows.length - 1) || (newRows[i+1].currency !== curr);
      if (isLast) {
        let blockLen = (i - blockStartIdx) + 1;
        let template = (CONFIG.MULTI_CURRENCY_SHEETS.includes(name) && currencyRowMap[curr]) ? currencyRowMap[curr] : nearestRow;
        if (template > 0) {
          sheet.getRange(template, 1, 1, CONFIG.CLONE_COL_COUNT).copyTo(sheet.getRange(startAppendRow + blockStartIdx, 1, blockLen, CONFIG.CLONE_COL_COUNT));
        }
        blockStartIdx = i + 1;
      }
    }

    // Write Values over cloned templates
    let cols = [0,1,2,3,4,5,7,15,16];
    cols.forEach(ci => sheet.getRange(startAppendRow, ci+1, outputValues.length, 1).setValues(outputValues.map(rv => [rv[ci]])));

    // Final Sort only the data block
    if (startAppendRow + outputValues.length > stats.startRow) {
      let sortStart = stats.startRow || startAppendRow;
      sheet.getRange(sortStart, 1, (startAppendRow + outputValues.length - sortStart), CONFIG.CLONE_COL_COUNT).sort([{column: 2, ascending: true}]);
    }
  });

  Browser.msgBox(`Completed. ${orphanedSells > 0 ? 'WARNING: ' + orphanedSells + ' Orphaned Sells.' : ''}`);
}

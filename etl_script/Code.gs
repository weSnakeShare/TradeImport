/**
 * Trade Matcher (LIFO) - Multi-Sheet Version (Optimized)
 * 
 * Features:
 * 1. Supports multiple output sheets: 'ProcessedTrade2' (T212) and 'SampleTrades' (Others).
 * 2. Incremental Append: Updates existing rows, appends new ones.
 * 3. Smart Cloning: Copies formulas/formats from template rows using BULK operations for speed.
 * 4. Stacks: Global portfolio tracking across sheets.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Trade Tools')
      .addItem('Process Trades (LIFO Optimized)', 'processTrades')
      .addToUi();
}

function processTrades() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ss.getSheetByName('Raw Imports');
  
  // Define Output Sheet Map
  // T212lsy -> ProcessedTrade2
  // Default -> SampleTrades
  const SHEET_MAP = {
    'T212lsy': 'ProcessedTrade2',
    'DEFAULT': 'SampleTrades'
  };

  if (!rawSheet) {
    Browser.msgBox("Error: Missing 'Raw Imports' sheet.");
    return;
  }

  // Ensure output sheets exist
  let sheets = {};
  ['ProcessedTrade2', 'SampleTrades'].forEach(name => {
    let s = ss.getSheetByName(name);
    if (!s) {
       s = ss.insertSheet(name);
       s.appendRow(['Stock','B date','S date','Qty','BPrice','SPrice','','a/c','','','','','','','','Commission','Currency']); 
    }
    sheets[name] = s;
  });

  const EPSILON = 0.000000001; 
  let portfolio = {}; // Key: "Account|Symbol" -> Array of Objects
  
  // --- 1. Load Existing Open Positions ---
  function loadSheetData(sheetName) {
    let sheet = sheets[sheetName];
    let lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    // Read Cols A-Q
    let data = sheet.getRange(2, 1, lastRow - 1, 17).getValues();
    
    data.forEach((row, idx) => {
      let rowNum = idx + 2;
      let stock = row[0].toString().trim();
      let bDate = row[1];
      let sDate = row[2];
      let qty = row[3];
      let bPrice = row[4];
      let ac = row[7].toString().trim();
      let bComm = row[15];
      let curr = row[16];

      let isSold = (sDate && sDate.toString().trim() !== "");
      
      if (stock && qty && !isSold) {
        let key = ac + "|" + stock;
        if (!portfolio[key]) portfolio[key] = [];
        
        portfolio[key].push({
          sheetName: sheetName,
          rowNum: rowNum,
          stock: stock,
          bDate: bDate,
          qty: parseFloat(qty),
          bPrice: parseFloat(bPrice),
          bComm: parseFloat(bComm) || 0,
          ac: ac,
          currency: curr
        });
      }
    });
  }

  loadSheetData('SampleTrades');
  loadSheetData('ProcessedTrade2');

  // --- 2. Read NEW Trades ---
  const rawData = rawSheet.getDataRange().getValues();
  if (rawData.length <= 1) {
    Browser.msgBox("No data in Raw Imports.");
    return; 
  }
  let newTradesSource = rawData.slice(1);
  
  // Sort: Date Ask, Buy then Sell
  newTradesSource.sort((a, b) => {
     let dateA = new Date(a[0]);
     let dateB = new Date(b[0]);
     if (dateA < dateB) return -1;
     if (dateA > dateB) return 1;
     let sideA = a[3].toString().toUpperCase();
     let sideB = b[3].toString().toUpperCase();
     if (sideA === 'BUY' && sideB === 'SELL') return -1;
     if (sideA === 'SELL' && sideB === 'BUY') return 1;
     return 0;
  });

  // --- 3. Processing ---
  let rowsToAppend = {
    'SampleTrades': [],
    'ProcessedTrade2': []
  };
  
  let updates = []; 
  let orphanedSells = 0;

  function addUpdate(sheet, r, c, v) {
    updates.push({sheetName: sheet, row: r, col: c, val: v});
  }
  
  function formatDate(d) {
    if (!d) return "";
    try {
       let dateObj = new Date(d);
       if (isNaN(dateObj.getTime())) return d; 
       return Utilities.formatDate(dateObj, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
    } catch(e) { return d; }
  }

  function getTargetSheet(account) {
    if (account === 'T212lsy') return SHEET_MAP['T212lsy'];
    return SHEET_MAP['DEFAULT'];
  }

  newTradesSource.forEach(row => {
    let dateStr = formatDate(row[0]);
    let account = row[1].toString().trim();
    let symbol = row[2].toString().trim();
    let side = row[3].toString().toUpperCase().trim();
    let qty = parseFloat(row[4]);
    let price = parseFloat(row[5]);
    let fees = parseFloat(row[6]) || 0;
    let currency = row[7].toString().trim();

    if (!qty || isNaN(qty)) return;
    
    let key = account + "|" + symbol;
    if (!portfolio[key]) portfolio[key] = [];
    
    let targetSheet = getTargetSheet(account);

    if (side === 'BUY') {
      let newLot = {
        sheetName: targetSheet,
        rowNum: null, 
        stock: symbol,
        bDate: dateStr,
        qty: qty,
        bPrice: price,
        bComm: fees,
        ac: account,
        currency: currency
      };
      
      portfolio[key].push(newLot);
      rowsToAppend[targetSheet].push(newLot);
      
    } else if (side === 'SELL') {
      let remainingQtyToSell = qty;
      let totalSellComm = fees;

      while (remainingQtyToSell > EPSILON) {
        if (portfolio[key].length === 0) {
          orphanedSells++;
          let orphanComm = (remainingQtyToSell / qty) * fees;
          rowsToAppend[targetSheet].push({
             sheetName: targetSheet,
             rowNum: null,
             stock: symbol,
             bDate: "MISSING_BUY", 
             sDate: dateStr,
             qty: remainingQtyToSell,
             bPrice: 0,
             sPrice: price,
             comm: orphanComm,
             ac: account,
             currency: currency
          });
          break;
        }

        let lastIdx = portfolio[key].length - 1;
        let buyLot = portfolio[key][lastIdx];
        
        let isExistingRow = (buyLot.rowNum !== null);
        let matchQty = Math.min(remainingQtyToSell, buyLot.qty);
        
        let matchSellComm = (matchQty / qty) * totalSellComm;
        let matchBuyComm = (matchQty / buyLot.qty) * buyLot.bComm;
        let isSplit = (Math.abs(buyLot.qty - matchQty) > EPSILON);

        if (isExistingRow) {
          let sName = buyLot.sheetName;
          addUpdate(sName, buyLot.rowNum, 3, dateStr); 
          addUpdate(sName, buyLot.rowNum, 6, price);   
          
          if (isSplit) {
             addUpdate(sName, buyLot.rowNum, 4, matchQty); 
             addUpdate(sName, buyLot.rowNum, 16, matchBuyComm + matchSellComm);

             let remSheet = buyLot.sheetName;
             let remainderQty = buyLot.qty - matchQty;
             let remainderBuyComm = buyLot.bComm - matchBuyComm;
             
             let remainderLot = {
               sheetName: remSheet,
               rowNum: null,
               stock: buyLot.stock,
               bDate: formatDate(buyLot.bDate),
               qty: remainderQty,
               bPrice: buyLot.bPrice,
               bComm: remainderBuyComm,
               ac: buyLot.ac,
               currency: buyLot.currency
             };
             
             rowsToAppend[remSheet].push(remainderLot);
             portfolio[key][lastIdx] = remainderLot;
             
          } else {
             addUpdate(sName, buyLot.rowNum, 16, (buyLot.bComm || 0) + matchSellComm);
          }
          
        } else {
          buyLot.sDate = dateStr;
          buyLot.sPrice = price;
           
          if (isSplit) {
             let origQty = buyLot.qty;
             let origComm = buyLot.bComm;
             
             buyLot.qty = matchQty;
             buyLot.comm = matchBuyComm + matchSellComm;
             
             let remainderQty = origQty - matchQty;
             let remainderBuyComm = origComm - matchBuyComm;
             
             let remainderLot = {
                sheetName: buyLot.sheetName,
                rowNum: null,
                stock: buyLot.stock,
                bDate: buyLot.bDate,
                qty: remainderQty,
                bPrice: buyLot.bPrice,
                bComm: remainderBuyComm,
                ac: buyLot.ac,
                currency: buyLot.currency
             };
             
             rowsToAppend[buyLot.sheetName].push(remainderLot);
             portfolio[key][lastIdx] = remainderLot;

          } else {
             buyLot.comm = buyLot.bComm + matchSellComm;
          }
        }
        
        if (!isSplit) portfolio[key].pop(); 
        remainingQtyToSell -= matchQty;
      }
    }
  });

  // --- 4. Commit Changes ---
  
  // A. Apply Updates
  updates.forEach(u => {
    let s = sheets[u.sheetName];
    if (s) s.getRange(u.row, u.col).setValue(u.val);
  });
  
  // B. Output Appends per Sheet
  Object.keys(rowsToAppend).forEach(sheetName => {
    let newRows = rowsToAppend[sheetName];
    if (newRows.length === 0) return;
    
    let sheet = sheets[sheetName];
    let lastSheetRow = sheet.getLastRow();
    
    // 1. Find Template Rows
    // Strategy: 
    // - For 'ProcessedTrade2': Use Currency Map (last row of specific currency).
    // - For 'SampleTrades': Use the VERY LAST ROW available (User requirement: "reference existing latest trade record... regardless of currency").
    
    let currencyRowMap = {};
    let simpleTemplateRow = null;
    
    if (lastSheetRow > 1) {
       if (sheetName === 'ProcessedTrade2') {
          // Currency-based mapping
          let currData = sheet.getRange(2, 17, lastSheetRow - 1, 1).getValues(); 
          for (let i = currData.length - 1; i >= 0; i--) {
              let c = currData[i][0].toString().trim();
              if (!currencyRowMap[c]) currencyRowMap[c] = i + 2; 
          }
       } else {
          // Simple Mode: Just use the last row
          simpleTemplateRow = lastSheetRow;
       }
    }
    
    // 2. Sort New Rows?
    // - For ProcessedTrade2: Sort by Currency to batch copy.
    // - For SampleTrades: Order doesn't matter for copying (same template), but we promised Date order.
    // Let's keep the sort logic consistent or branching.
    
    if (sheetName === 'ProcessedTrade2') {
        newRows.sort((a, b) => {
            let ca = a.currency || "";
            let cb = b.currency || "";
            return ca.localeCompare(cb);
        });
    } else {
        // SampleTrades: Keep Date Order (already mostly sorted, but newRows came from dict grouping which might lose order?)
        // Actually rowsToAppend[sheetName] was pushed in order of processing (Date).
        // So we don't need to re-sort for SampleTrades.
    }

    let outputValues = [];
    let startRow = lastSheetRow + 1;
    let currentBlockStart = 0;
    
    // Build Output Array
    newRows.forEach(r => {
        let rowArr = new Array(24).fill(""); 
        rowArr[0] = r.stock;
        rowArr[1] = r.bDate;
        rowArr[2] = r.sDate || "";
        rowArr[3] = r.qty;
        rowArr[4] = r.bPrice;
        rowArr[5] = r.sPrice || "";
        rowArr[7] = r.ac;
        rowArr[15] = (r.comm !== undefined && r.comm !== null) ? r.comm : r.bComm; 
        rowArr[16] = r.currency || "";
        outputValues.push(rowArr);
    });

    // 3. Batch Format Copying
    if (sheetName === 'ProcessedTrade2') {
        // Currency-based Batching
        for (let i = 0; i < newRows.length; i++) {
            let curr = newRows[i].currency || "";
            let nextCurr = (i < newRows.length - 1) ? (newRows[i+1].currency || "") : null;
            
            if (curr !== nextCurr) {
                let blockLen = (i - currentBlockStart) + 1;
                let targetRowStart = startRow + currentBlockStart;
                let templateRow = currencyRowMap[curr];
                
                if (templateRow) {
                    let templateRange = sheet.getRange(templateRow, 1, 1, sheet.getLastColumn());
                    let targetRange = sheet.getRange(targetRowStart, 1, blockLen, sheet.getLastColumn());
                    templateRange.copyTo(targetRange); 
                }
                currentBlockStart = i + 1;
            }
        }
    } else {
        // Simple Mode: Bulk copy single template to ALL new rows
        if (simpleTemplateRow) {
             let templateRange = sheet.getRange(simpleTemplateRow, 1, 1, sheet.getLastColumn());
             let targetRange = sheet.getRange(startRow, 1, outputValues.length, sheet.getLastColumn());
             templateRange.copyTo(targetRange);
        }
    }
    
    // 4. Batch Write Values
    let nRows = outputValues.length;
    let getCol = (idx) => outputValues.map(row => [row[idx]]);

    sheet.getRange(startRow, 1, nRows, 1).setValues(getCol(0)); // A
    sheet.getRange(startRow, 2, nRows, 1).setValues(getCol(1)); // B
    sheet.getRange(startRow, 3, nRows, 1).setValues(getCol(2)); // C
    sheet.getRange(startRow, 4, nRows, 1).setValues(getCol(3)); // D
    sheet.getRange(startRow, 5, nRows, 1).setValues(getCol(4)); // E
    sheet.getRange(startRow, 6, nRows, 1).setValues(getCol(5)); // F
    sheet.getRange(startRow, 8, nRows, 1).setValues(getCol(7)); // H
    sheet.getRange(startRow, 16, nRows, 1).setValues(getCol(15)); // P 
    sheet.getRange(startRow, 17, nRows, 1).setValues(getCol(16)); // Q

    // 5. Final Sort by Date
    let finalRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
    finalRange.sort([{column: 2, ascending: true}]);
  });

  let msg = `Completed.`;
  if (orphanedSells > 0) msg += ` WARNING: ${orphanedSells} Orphaned Sells.`;
  Browser.msgBox(msg);
}

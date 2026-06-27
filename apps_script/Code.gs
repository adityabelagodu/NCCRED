/**
 * RACHNA ENTERPRISES — phone quote maker (Google Apps Script), no-API version.
 *
 * You fill a simple form (thickness, brand, size, sheets, rate); it prices the
 * quote, appends rows to QUOTATIONS, and emails you the PDF from your formatted
 * tabs. No API key, no external service, no per-quote cost.
 *
 *   - new quote  -> "claude landscape" / "claude portrait" tabs (latest quote)
 *   - re-print   -> "landscape" / "portrait" tabs via cell H4
 *
 * Setup is in apps_script/README.md.
 */

// ---- Settings ---------------------------------------------------------------
var DATA_TAB = 'QUOTATIONS';
var LATEST_LANDSCAPE_TAB = 'claude landscape';
var LATEST_PORTRAIT_TAB = 'claude portrait';
var LOOKUP_LANDSCAPE_TAB = 'landscape';
var LOOKUP_PORTRAIT_TAB = 'portrait';
var QUOTE_INPUT_CELL = 'H4';
var LANDSCAPE_MAX_ITEMS = 8;
var RATE_EXTRA_PCT = 1.0;
var DEFAULT_GST_PCT = 18.0;
var TIMEZONE = 'Asia/Kolkata';
var FIRST_DATA_ROW = 2; // row 1 is the header on QUOTATIONS

// Glass brand/type catalog (for the brand dropdown).
var BRANDS = [
  'asahi', 'asahi aqua blue reflective', 'asahi bronze mirror',
  'asahi bronze tinted', 'asahi coral green reflective',
  'asahi double line design frosted', 'asahi frosted', 'asahi grey mirror',
  'asahi grey reflective', 'asahi grey tinted', 'asahi mirror',
  'asahi neo golden bronze reflective', 'asahi royal blue frosted cross hatch',
  'asahi royal blue reflective', 'ceasars pinhead', 'emirates', 'ggl',
  'ggl blue reflective (climaguard)', 'ggl bronze reflective (climaguard)',
  'ggl grey reflective (climaguard)', 'ggl mirror', 'gold plus', 'gpil frosted',
  'gpil grey tinted', 'hng', 'hng double line design frosted', 'hng mirror',
  'imported', 'imported frosted', 'nanumal karthachi', 'nanumal kasumi',
  'nanumal pinhead', 'sejal', 'sg', 'sg bronze reflective', 'sg bronze tinted',
  'sg dark blue reflective', 'sg gold mirror', 'sg gold reflective',
  'sg grey reflective', 'sg grey tinted', 'sg mirror', 'sg rose gold mirror',
  'sg sapphire blue reflective', 'sg ultrafix clear silicone', 'sumangal fluted',
  'sumangal karthachi', 'sumangal kasumi', 'sumangal matrix', 'sumangal mgn',
  'sumangal pinhead', 'sumangal sparkle', 'wave glass blocks indonesia',
  'xyg ar', 'xyg mirror'
];

// ---- Web app entry ----------------------------------------------------------
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.brandsJson = JSON.stringify(BRANDS);
  return t.evaluate()
    .setTitle('Rachna Quote')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---- Rates (optional "Rates" tab) ------------------------------------------
function readRatesTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Rates');
  var map = {};
  if (!sheet) return map;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    var brand = String(row[0]).trim().toLowerCase();
    var thickness = parseFloat(row[1]);
    var rate = parseFloat(row[2]);
    var gst = row[3] !== '' && row[3] != null ? parseFloat(row[3]) : DEFAULT_GST_PCT;
    if (brand && !isNaN(thickness) && !isNaN(rate)) {
      map[brand + '|' + thickness] = { rate: rate, gst: gst };
    }
  }
  return map;
}

// ---- Pricing (matches quote #1284) -----------------------------------------
function priceItem_(item, rate, gst) {
  var area = (item.length_cm / 100) * (item.breadth_cm / 100) * item.sheets;
  var line = {
    thickness_mm: item.thickness_mm, brand: item.brand,
    length_cm: item.length_cm, breadth_cm: item.breadth_cm, sheets: item.sheets,
    notes: item.notes || '', area_m2: round_(area, 4),
    rate: null, gst: null, taxable: 0, cgst: 0, sgst: 0, total: 0,
    rate_missing: (rate === null || rate === undefined)
  };
  if (rate !== null && rate !== undefined) {
    var valueIncl = rate * (1 + RATE_EXTRA_PCT / 100) * item.thickness_mm * area;
    line.rate = rate;
    line.gst = gst;
    line.total = Math.round(valueIncl);
    line.taxable = round_(valueIncl / (1 + gst / 100), 2);
    var half = round_(line.taxable * (gst / 100) / 2, 2);
    line.cgst = half;
    line.sgst = half;
  }
  return line;
}

function round_(n, dp) {
  var f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'd-MMMM-yy');
}

function blankRow_(it) {
  return !it.thickness && !it.brand && !it.length && !it.breadth && !it.sheets && !it.rate;
}

// ---- Server endpoints called from the page ---------------------------------

/** Preview a quote from the form, without writing anything. */
function previewQuote(payload) {
  var rates = readRatesTab_();
  var lines = [];
  (payload.items || []).forEach(function (it, idx) {
    if (blankRow_(it)) return;
    var thickness = parseFloat(it.thickness);
    var length = parseFloat(it.length);
    var breadth = parseFloat(it.breadth);
    var sheets = parseInt(it.sheets, 10);
    var brand = (it.brand || '').trim();
    if (!brand || isNaN(thickness) || isNaN(length) || isNaN(breadth) || isNaN(sheets)) {
      throw new Error('Item ' + (idx + 1) +
        ' is incomplete — fill thickness, brand, length, breadth and sheets.');
    }
    var rate = (it.rate !== '' && it.rate != null && !isNaN(parseFloat(it.rate)))
      ? parseFloat(it.rate) : null;
    var gst = (it.gst !== '' && it.gst != null && !isNaN(parseFloat(it.gst)))
      ? parseFloat(it.gst) : DEFAULT_GST_PCT;
    if (rate === null) {
      var r = rates[brand.toLowerCase() + '|' + thickness];
      if (r) { rate = r.rate; gst = r.gst; }
    }
    lines.push(priceItem_({
      thickness_mm: thickness, brand: brand,
      length_cm: length, breadth_cm: breadth, sheets: sheets, notes: ''
    }, rate, gst));
  });

  if (!lines.length) throw new Error('Add at least one item.');

  var missing = lines.filter(function (l) { return l.rate_missing; }).map(function (l) {
    return l.brand + ' ' + l.thickness_mm + 'mm';
  });
  var taxable = 0, cgst = 0, sgst = 0, total = 0;
  lines.forEach(function (l) {
    taxable += l.taxable; cgst += l.cgst; sgst += l.sgst; total += l.total;
  });

  return {
    ok: missing.length === 0,
    customer: (payload.customer || '').trim(),
    date: todayStr_(),
    lines: lines,
    missing: missing,
    totals: {
      taxable: round_(taxable, 2), cgst: round_(cgst, 2),
      sgst: round_(sgst, 2), total: Math.round(total)
    }
  };
}

/** Commit a previewed quote: insert rows (with the sheet's formulas) + PDF. */
function commitQuote(quote) {
  if (!quote || !quote.lines || !quote.lines.length) {
    throw new Error('Nothing to commit.');
  }
  if (quote.missing && quote.missing.length) {
    throw new Error('Add rates for: ' + quote.missing.join(', '));
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  if (!data) throw new Error('Tab "' + DATA_TAB + '" not found.');

  var quoteNumber = nextQuoteNumber_(data);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var nCols = Math.max(26, data.getLastColumn());
    // Last row that actually holds a quote (column C = quote#).
    var lastQuoteRow = lastRowInColumn_(data, 3);
    var tmplRow = (lastQuoteRow >= FIRST_DATA_ROW) ? lastQuoteRow : null;
    var insertAfter = (lastQuoteRow >= FIRST_DATA_ROW) ? lastQuoteRow : (FIRST_DATA_ROW - 1);

    quote.lines.forEach(function (l, idx) {
      var target = insertAfter + 1 + idx;
      data.insertRowAfter(insertAfter + idx);
      // Copy a real quote row so column A (Vlookup key) and the calc columns
      // K..AD keep their formulas for this new row.
      if (tmplRow) {
        data.getRange(tmplRow, 1, 1, nCols).copyTo(data.getRange(target, 1, 1, nCols));
      }
      // Overwrite ONLY the input columns B..J (date, quote#, customer, thickness,
      // brand, length, breadth, sheets, rate). Column A and K..AD stay as formulas.
      data.getRange(target, 2, 1, 9).setValues([[
        quote.date, quoteNumber, quote.customer,
        l.thickness_mm, l.brand, l.length_cm, l.breadth_cm, l.sheets, l.rate
      ]]);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  var portrait = quote.lines.length > LANDSCAPE_MAX_ITEMS;
  var tab = portrait ? LATEST_PORTRAIT_TAB : LATEST_LANDSCAPE_TAB;
  var fileName = 'Quote_' + quoteNumber + '_' + safeName_(quote.customer) + '.pdf';
  var blob = exportTabPdf_(tab, portrait, fileName);
  var link = deliver_(blob, quoteNumber, quote.customer);

  return { quoteNumber: quoteNumber, orientation: portrait ? 'portrait' : 'landscape', link: link };
}

/** Last row (>= header) whose given column has a value; 0 if none. */
function lastRowInColumn_(sheet, col) {
  var last = sheet.getLastRow();
  if (last < 1) return 0;
  var vals = sheet.getRange(1, col, last, 1).getValues();
  for (var r = vals.length; r >= 1; r--) {
    if (vals[r - 1][0] !== '' && vals[r - 1][0] != null) return r;
  }
  return 0;
}

/** Re-print an existing quote by number using the lookup tabs (cell H4). */
function reprintQuote(quoteNumber) {
  quoteNumber = parseInt(quoteNumber, 10);
  if (!quoteNumber) throw new Error('Enter a quote number.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  var summary = summariseQuote_(data, quoteNumber);
  if (summary.count === 0) {
    throw new Error('Quote #' + quoteNumber + ' not found in ' + DATA_TAB + '.');
  }
  var portrait = summary.count > LANDSCAPE_MAX_ITEMS;
  var tabName = portrait ? LOOKUP_PORTRAIT_TAB : LOOKUP_LANDSCAPE_TAB;
  var tab = ss.getSheetByName(tabName);
  if (!tab) throw new Error('Tab "' + tabName + '" not found.');

  var cell = tab.getRange(QUOTE_INPUT_CELL);
  var previous = cell.getValue();
  cell.setValue(quoteNumber);
  SpreadsheetApp.flush();
  try {
    var fileName = 'Quote_' + quoteNumber + '_' + safeName_(summary.customer) + '.pdf';
    var blob = exportTabPdf_(tabName, portrait, fileName);
    var link = deliver_(blob, quoteNumber, summary.customer);
    return { quoteNumber: quoteNumber, orientation: portrait ? 'portrait' : 'landscape', link: link };
  } finally {
    cell.setValue(previous === '' ? '' : previous);
    SpreadsheetApp.flush();
  }
}

// ---- Helpers ----------------------------------------------------------------
function nextQuoteNumber_(dataSheet) {
  var last = dataSheet.getLastRow();
  if (last < FIRST_DATA_ROW) return 1285;
  var col = dataSheet.getRange(FIRST_DATA_ROW, 3, last - FIRST_DATA_ROW + 1, 1).getValues();
  var max = 0;
  col.forEach(function (r) {
    var n = parseInt(r[0], 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max ? max + 1 : 1285;
}

function summariseQuote_(dataSheet, quoteNumber) {
  var last = dataSheet.getLastRow();
  var out = { count: 0, customer: '', date: '' };
  if (last < FIRST_DATA_ROW) return out;
  var rows = dataSheet.getRange(FIRST_DATA_ROW, 2, last - FIRST_DATA_ROW + 1, 3).getValues();
  rows.forEach(function (r) {
    if (parseInt(r[1], 10) === quoteNumber) {
      out.count++;
      if (!out.date) out.date = r[0];
      if (!out.customer) out.customer = r[2];
    }
  });
  return out;
}

function exportTabPdf_(tabName, portrait, fileName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" not found.');
  var gid = sheet.getSheetId();
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?' +
    'format=pdf' +
    '&gid=' + gid +
    '&portrait=' + (portrait ? 'true' : 'false') +
    '&size=A4' +
    '&scale=4' + // 4 = fit to page, so the whole quote is one page
    '&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false' +
    '&top_margin=0.25&bottom_margin=0.25&left_margin=0.25&right_margin=0.25' +
    '&horizontal_alignment=CENTER&vertical_alignment=TOP';
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('PDF export failed (' + resp.getResponseCode() + ').');
  }
  return resp.getBlob().setName(fileName);
}

function deliver_(blob, quoteNumber, customer) {
  var folders = DriveApp.getFoldersByName('Rachna Quotes');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Rachna Quotes');
  var file = folder.createFile(blob);
  var email = Session.getActiveUser().getEmail();
  if (email) {
    MailApp.sendEmail({
      to: email,
      subject: 'Quotation #' + quoteNumber + (customer ? ' - ' + customer : ''),
      body: 'Your quotation PDF is attached.\nAlso saved in Drive: ' + file.getUrl(),
      attachments: [blob]
    });
  }
  return file.getUrl();
}

function safeName_(s) {
  return String(s || 'customer').replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_|_$/g, '') || 'customer';
}

// ---- Live stock lookup ------------------------------------------------------
// Shows J / JP / O stock (columns U / W / Y) for the item being entered, using
// the QUOTATIONS sheet's own per-row stock formulas. Runs them on a hidden
// helper sheet so your real quote rows are never touched.

var STOCK_HELPER = '_stock_helper';
var STOCK_COL_J = 21;   // U  - J stock pieces
var STOCK_COL_JP = 23;  // W  - JP stock pieces
var STOCK_COL_O = 25;   // Y  - O stock pieces

/** Called from the page as each item's brand+thickness+size are filled in. */
function lookupStock(item) {
  var thickness = parseFloat(item.thickness);
  var length = parseFloat(item.length);
  var breadth = parseFloat(item.breadth);
  var brand = (item.brand || '').trim();
  if (!brand || isNaN(thickness) || isNaN(length) || isNaN(breadth)) {
    return null; // not enough entered yet
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var src = ss.getSheetByName(DATA_TAB);
    if (!src) return { unavailable: true };
    var nCols = Math.max(26, src.getLastColumn());

    var tmplRow = findStockFormulaRow_(src);
    if (!tmplRow) return { unavailable: true };

    var helper = getStockHelper_(ss, src, tmplRow, nCols);
    // Feed the item into E:H (Thickness, Brand, Length, Breadth).
    helper.getRange(2, 5, 1, 4).setValues([[thickness, brand, length, breadth]]);
    SpreadsheetApp.flush();

    return {
      j: toNum_(helper.getRange(2, STOCK_COL_J).getValue()),
      jp: toNum_(helper.getRange(2, STOCK_COL_JP).getValue()),
      o: toNum_(helper.getRange(2, STOCK_COL_O).getValue())
    };
  } finally {
    lock.releaseLock();
  }
}

/** Find a recent QUOTATIONS row whose U/W/Y actually hold formulas to clone. */
function findStockFormulaRow_(src) {
  var last = src.getLastRow();
  if (last < FIRST_DATA_ROW) return null;
  var start = Math.max(FIRST_DATA_ROW, last - 120);
  var n = last - start + 1;
  var f = src.getRange(start, STOCK_COL_J, n, 5).getFormulas(); // U..Y
  for (var i = n - 1; i >= 0; i--) {
    if (f[i][0] || f[i][2] || f[i][4]) return start + i; // U, W, Y
  }
  return null;
}

/** Hidden helper sheet holding one row that mirrors a QUOTATIONS row's formulas. */
function getStockHelper_(ss, src, tmplRow, nCols) {
  var helper = ss.getSheetByName(STOCK_HELPER);
  if (!helper) helper = ss.insertSheet(STOCK_HELPER);
  var formulas = src.getRange(tmplRow, 1, 1, nCols).getFormulasR1C1();
  helper.getRange(2, 1, 1, nCols).setFormulasR1C1(formulas);
  try { helper.hideSheet(); } catch (e) { /* already hidden */ }
  return helper;
}

function toNum_(v) {
  if (v === '' || v == null) return 0;
  if (typeof v === 'string' && v.charAt(0) === '#') return 0; // #N/A etc.
  var n = Number(v);
  return isNaN(n) ? v : n;
}

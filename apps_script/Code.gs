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

/** Commit a previewed quote: append rows + export & email the PDF. */
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
  quote.lines.forEach(function (l) {
    data.appendRow([
      '', quote.date, quoteNumber, quote.customer,
      l.thickness_mm, l.brand, l.length_cm, l.breadth_cm, l.sheets, l.rate
    ]);
  });
  SpreadsheetApp.flush();

  var portrait = quote.lines.length > LANDSCAPE_MAX_ITEMS;
  var tab = portrait ? LATEST_PORTRAIT_TAB : LATEST_LANDSCAPE_TAB;
  var fileName = 'Quote_' + quoteNumber + '_' + safeName_(quote.customer) + '.pdf';
  var blob = exportTabPdf_(tab, portrait, fileName);
  var link = deliver_(blob, quoteNumber, quote.customer);

  return { quoteNumber: quoteNumber, orientation: portrait ? 'portrait' : 'landscape', link: link };
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
    '&size=A4&fitw=true&gridlines=false&printtitle=false&sheetnames=false' +
    '&horizontal_alignment=CENTER';
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

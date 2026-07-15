/**
 * RACHNA ENTERPRISES — phone quote maker (Google Apps Script), no-API version.
 *
 * You fill a simple form (thickness, brand, size, sheets, rate); it prices the
 * quote, appends rows to QUOTATIONS, and makes the PDF from your formatted
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
var LOOKUP_PORTRAIT_TAB = 'Portrait'; // capital P — the tab's exact name
var QUOTE_INPUT_CELL = 'G4'; // the lookup formulas read G4 (G4:M4 shown merged)
var LANDSCAPE_MAX_ITEMS = 8;
var RATE_EXTRA_PCT = 1.0;
var DEFAULT_GST_PCT = 18.0;
var TIMEZONE = 'Asia/Kolkata';
var FIRST_DATA_ROW = 2; // row 1 is the header on QUOTATIONS

// Tally billing: the app can't reach Tally (it runs on the office computer),
// so bill requests are QUEUED in this tab; the office computer picks them up.
var TALLY_TAB = 'Tally Bills';
// Shared secret for the office computer's fetch/mark-done calls (?tally=...&key=...).
// Change it to anything private; use the same value on the office computer.
var TALLY_API_KEY = 'rachna-7f3k-tally-2026-x9q';

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
  'xyg ar', 'xyg mirror',
  // Charge lines (priced by m² × rate per m², not by glass dimensions):
  'loading', 'transport'
];

// Brands that are a CHARGE line (loading / transport): the user enters m^2 and
// Rate per m^2 (pretax) directly, instead of thickness/size/sheets.
function isChargeBrand_(brand) {
  var b = (brand || '').trim().toLowerCase();
  return b === 'loading' || b === 'transport' || b === 'transportation' ||
         b.indexOf('loading') >= 0 || b.indexOf('transport') >= 0;
}

// ---- Web app entry ----------------------------------------------------------
function doGet(e) {
  // JSON API for the office computer's Tally bridge (?tally=pending&key=...).
  if (e && e.parameter && e.parameter.tally) return tallyApi_(e);

  var t = HtmlService.createTemplateFromFile('Index');
  t.brandsJson = JSON.stringify(BRANDS);
  t.customersJson = JSON.stringify(customerList_());
  t.customerInfoJson = JSON.stringify(customerInfo_());
  t.godownsJson = JSON.stringify(godownList_());
  return t.evaluate()
    .setTitle('Rachna Quote')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Address (Customers col B) and GSTIN (col C) keyed by lower-cased name, so the
 *  form can show them under the customer field to confirm while quoting. */
function customerInfo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ctab = ss.getSheetByName('Customers');
  var info = {};
  if (!ctab || ctab.getLastRow() < 1) return info;
  var vals = ctab.getRange(1, 1, ctab.getLastRow(), 3).getValues(); // A name, B address, C GSTIN
  vals.forEach(function (r) {
    var name = String(r[0] == null ? '' : r[0]).trim();
    if (!name) return;
    var k = name.toLowerCase();
    if (info[k]) return; // first entry for a name wins
    info[k] = {
      address: String(r[1] == null ? '' : r[1]).trim(),
      gstin: String(r[2] == null ? '' : r[2]).trim()
    };
  });
  return info;
}

/** Customer suggestions for the search dropdown: everyone already quoted
 *  (QUOTATIONS column D) plus, if present, a "Customers" tab (column A) — paste
 *  your Tally Sundry Debtors export there. De-duplicated, sorted A→Z. */
function customerList_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var seen = {}, out = [];
  var add = function (v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return;
    var k = s.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1; out.push(s);
  };
  var ctab = ss.getSheetByName('Customers');
  if (ctab && ctab.getLastRow() >= 1) {
    ctab.getRange(1, 1, ctab.getLastRow(), 1).getValues().forEach(function (r) { add(r[0]); });
  }
  var data = ss.getSheetByName(DATA_TAB);
  if (data) {
    var bottom = lastLedgerRow_(data);
    if (bottom >= FIRST_DATA_ROW) {
      data.getRange(FIRST_DATA_ROW, 4, bottom - FIRST_DATA_ROW + 1, 1)
        .getValues().forEach(function (r) { add(r[0]); });
    }
  }
  out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  return out;
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

// ---- Pricing (mirrors the QUOTATIONS sheet formulas) -----------------------
// Sheet columns: K=m^2, L=Rate per m^2 (pretax), M=Handling (=K*L*1%),
// N=Pre-tax value (=K*L+M), O=Invoice after tax (=N*1.18).
//   glass : K = L*B*sheets/10000 ;  L = thickness*rate*0.84746  (0.84746 = 1/1.18)
//   charge: K = m^2 entered ;       L = rate per m^2 entered (pretax)
// removeHandling drops M (the 1%), so N = K*L.
function priceLine_(item, removeHandling) {
  var line = {
    is_charge: !!item.is_charge, brand: item.brand, description: item.description || '',
    thickness_mm: 0, length_cm: 0, breadth_cm: 0, sheets: 0, rate: 0,
    m2: 0, rate_m2: 0, taxable: 0, taxable_full: 0, cgst: 0, sgst: 0, total: 0, rate_missing: false
  };
  var base; // K * L  (pre-tax, before handling)
  if (item.is_charge) {
    if (item.m2 === null || item.m2 === undefined || item.rate_m2 === null || item.rate_m2 === undefined) {
      line.rate_missing = true; return line;
    }
    line.m2 = round_(item.m2, 4);
    line.rate_m2 = round_(item.rate_m2, 4);
    // Use the rounded K/L that will actually be written to the sheet, so the
    // preview matches what the sheet recomputes from those literals.
    base = line.m2 * line.rate_m2;
  } else {
    if (item.rate === null || item.rate === undefined) { line.rate_missing = true; return line; }
    line.thickness_mm = item.thickness_mm;
    line.length_cm = item.length_cm;
    line.breadth_cm = item.breadth_cm;
    line.sheets = item.sheets;
    line.rate = item.rate;
    // Glass K/L are formulas on the sheet, recomputed from these inputs, so keep
    // full precision here to mirror them.
    var area = (item.length_cm / 100) * (item.breadth_cm / 100) * item.sheets;     // K
    var ratePerM2 = item.thickness_mm * item.rate * 0.84746;                        // L
    line.m2 = round_(area, 4);
    line.rate_m2 = round_(ratePerM2, 4);
    base = area * ratePerM2;
  }
  var handling = removeHandling ? 0 : base * 0.01;     // M
  var taxable = base + handling;                       // N (pre-tax value)
  line.taxable_full = taxable;                         // full precision, for grand total
  line.taxable = round_(taxable, 2);
  line.total = Math.round(taxable * 1.18);             // O, per-line display only
  var half = round_(taxable * 0.09, 2);
  line.cgst = half;
  line.sgst = half;
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
  var removeHandling = !!payload.removeHandling;
  var lines = [];
  (payload.items || []).forEach(function (it, idx) {
    var brand = (it.brand || '').trim();

    if (isChargeBrand_(brand)) {
      // Charge line: m^2 and Rate per m^2 (pretax) entered directly.
      var m2 = parseFloat(it.m2);
      var rateM2 = parseFloat(it.rate_m2);
      if (isNaN(m2) && isNaN(rateM2)) return; // left blank — skip
      if (isNaN(m2) || isNaN(rateM2)) {
        throw new Error('Charge line ' + (idx + 1) + ' (' + brand +
          ') — enter both m² and Rate per m².');
      }
      lines.push(priceLine_({
        is_charge: true, brand: brand, description: (it.description || '').trim(),
        m2: m2, rate_m2: rateM2
      }, removeHandling));
      return;
    }

    if (blankRow_(it)) return;
    var thickness = parseFloat(it.thickness);
    var length = parseFloat(it.length);
    var breadth = parseFloat(it.breadth);
    var sheets = parseInt(it.sheets, 10);
    if (!brand || isNaN(thickness) || isNaN(length) || isNaN(breadth) || isNaN(sheets)) {
      throw new Error('Item ' + (idx + 1) +
        ' is incomplete — fill thickness, brand, length, breadth and sheets.');
    }
    var rate = (it.rate !== '' && it.rate != null && !isNaN(parseFloat(it.rate)))
      ? parseFloat(it.rate) : null;
    if (rate === null) {
      var r = rates[brand.toLowerCase() + '|' + thickness];
      if (r) { rate = r.rate; }
    }
    lines.push(priceLine_({
      is_charge: false, brand: brand, description: (it.description || '').trim(),
      thickness_mm: thickness, length_cm: length, breadth_cm: breadth,
      sheets: sheets, rate: rate
    }, removeHandling));
  });

  if (!lines.length) throw new Error('Add at least one item.');

  var missing = lines.filter(function (l) { return l.rate_missing; }).map(function (l) {
    return l.is_charge ? (l.brand + ' (m²/rate)') : (l.brand + ' ' + l.thickness_mm + 'mm');
  });
  // Match the printed quote exactly: sum the full-precision pre-tax (N) values,
  // then derive Taxable / CGST / SGST / Total from that single sum (the sheet
  // rounds only for display). This keeps the previewed Total equal to the PDF.
  var taxFull = 0;
  lines.forEach(function (l) { taxFull += l.taxable_full; });

  return {
    ok: missing.length === 0,
    customer: (payload.customer || '').trim(),
    vehicle: (payload.vehicle || '').trim(),
    destination: (payload.destination || '').trim(),
    date: todayStr_(),
    removeHandling: removeHandling,
    lines: lines,
    missing: missing,
    totals: {
      taxable: round_(taxFull, 2),
      cgst: round_(taxFull * 0.09, 2),
      sgst: round_(taxFull * 0.09, 2),
      total: Math.round(taxFull * 1.18)
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
    var lastLedger = lastLedgerRow_(data);
    if (lastLedger < FIRST_DATA_ROW) lastLedger = FIRST_DATA_ROW - 1;
    var start = lastLedger + 1;
    data.insertRowsAfter(lastLedger, quote.lines.length);
    writeQuoteRows_(data, start, quoteNumber, quote);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Return NOW so the page can show "Saved" in a second or two. The page then
  // calls makeQuotePdf() for the export, which continues even if it takes long.
  return {
    quoteNumber: quoteNumber,
    count: quote.lines.length,
    customer: quote.customer,
    orientation: quote.lines.length > LANDSCAPE_MAX_ITEMS ? 'portrait' : 'landscape'
  };
}

/** Write one quote's lines into rows start..start+n-1 (which must already exist
 *  blank). Shared by commitQuote (new) and updateQuote (edit). */
function writeQuoteRows_(data, start, quoteNumber, quote) {
  var removeHandling = !!quote.removeHandling;
  var n = quote.lines.length;

  // Column B carries the vehicle number / destination (NOT the date) — the
  // printed quote shows it under the buyer's name, as labelled lines:
  //   Vehicle Number : KA05D5194
  //   Destination : Madiwala
  var vdParts = [];
  if ((quote.vehicle || '').trim()) vdParts.push('Vehicle Number : ' + quote.vehicle.trim());
  if ((quote.destination || '').trim()) vdParts.push('Destination : ' + quote.destination.trim());
  var vehicleDest = vdParts.join('\n');

  // Inputs B..J. Charge lines store thickness/size/sheets/rate as 0.
  data.getRange(start, 2, n, 9).setValues(quote.lines.map(function (l) {
    return [vehicleDest, quoteNumber, quote.customer,
            l.thickness_mm, l.brand, l.length_cm, l.breadth_cm, l.sheets, l.rate];
  }));

  // Additional description -> column Q (17); the print tabs read it from there.
  data.getRange(start, 17, n, 1).setValues(quote.lines.map(function (l) {
    return [l.description || ''];
  }));

  // The sheet's own calc formulas, written explicitly (see ledgerFormulas_).
  var fRows = quote.lines.map(function (_, idx) { return ledgerFormulas_(start + idx); });
  data.getRange(start, 1, n, 1).setFormulas(fRows.map(function (f) { return [f[1]]; }));
  data.getRange(start, 11, n, 6).setFormulas(fRows.map(function (f) {
    return [f[11], f[12], f[13], f[14], f[15], f[16]];
  }));
  data.getRange(start, 18, n, 11).setFormulas(fRows.map(function (f) {
    return [f[18], f[19], f[20], f[21], f[22], f[23], f[24], f[25], f[26], f[27], f[28]];
  }));
  data.getRange(start, 30, n, 1).setFormulas(fRows.map(function (f) { return [f[30]]; }));

  // AC as a plain value (sheet's own AC formula is a #REF!): 1 on line 1 so P
  // shows the invoice total once; >1 on later lines makes P = 0.
  data.getRange(start, 29, n, 1).setValues(quote.lines.map(function (_, idx) {
    return [idx === 0 ? 1 : 2];
  }));

  // Literal overrides AFTER the formulas: charge lines carry entered m²/rate in
  // K/L; removing handling zeroes M so N = K*L.
  quote.lines.forEach(function (l, idx) {
    if (l.is_charge) data.getRange(start + idx, 11, 1, 2).setValues([[l.m2, l.rate_m2]]);
  });
  if (removeHandling) {
    data.getRange(start, 13, n, 1).setValues(quote.lines.map(function () { return [0]; }));
  }
}

/** First row and line count of an existing quote's block in the ledger. */
function findQuoteRows_(data, quoteNumber) {
  var bottom = lastLedgerRow_(data);
  if (bottom < FIRST_DATA_ROW) return { firstRow: 0, count: 0 };
  var n = bottom - FIRST_DATA_ROW + 1;
  var c = data.getRange(FIRST_DATA_ROW, 3, n, 1).getValues(); // C quote#
  var e = data.getRange(FIRST_DATA_ROW, 5, n, 1).getValues(); // E thickness (real lines only)
  var first = 0, count = 0;
  for (var i = 0; i < n; i++) {
    var q = parseInt(c[i][0], 10);
    var filled = (e[i][0] !== '' && e[i][0] !== null);
    if (q === quoteNumber && filled) {
      if (!first) first = FIRST_DATA_ROW + i;
      count++;
    } else if (first) {
      break; // contiguous block ended
    }
  }
  return { firstRow: first, count: count };
}

/** Load an existing quote's fields so the page can edit it. */
function loadQuote(quoteNumber) {
  quoteNumber = parseInt(quoteNumber, 10);
  if (!quoteNumber) throw new Error('Enter a quote number.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  if (!data) throw new Error('Tab "' + DATA_TAB + '" not found.');
  var loc = findQuoteRows_(data, quoteNumber);
  if (!loc.count) throw new Error('Quote #' + quoteNumber + ' not found in ' + DATA_TAB + '.');

  // B..Q (2..17): 0 B(vehicle/dest) 2 D(customer) 3 E(thk) 4 F(brand) 5 G 6 H
  // 7 I 8 J(rate) 9 K(m²) 10 L(rate/m²) 11 M(handling) 15 Q(description).
  var vals = data.getRange(loc.firstRow, 2, loc.count, 16).getValues();

  var vehicle = '', destination = '';
  String(vals[0][0] || '').split('\n').forEach(function (ln) {
    var t = ln.trim();
    if (/^vehicle number\s*:/i.test(t)) vehicle = t.replace(/^vehicle number\s*:/i, '').trim();
    else if (/^destination\s*:/i.test(t)) destination = t.replace(/^destination\s*:/i, '').trim();
  });

  var removeHandling = false;
  var items = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var brand = String(r[4] || '');
    var charge = isChargeBrand_(brand);
    var num = function (v) { var x = parseFloat(v); return isNaN(x) ? 0 : x; };
    if (!charge) {
      var area = (num(r[5]) / 100) * (num(r[6]) / 100) * num(r[7]);
      var base = area * (num(r[3]) * num(r[8]) * 0.84746);
      var mv = r[11];
      var mn = (typeof mv === 'number') ? mv : parseFloat(mv);
      if (base > 0 && mv !== '' && mv !== null && !isNaN(mn) && mn === 0) removeHandling = true;
    }
    items.push({
      is_charge: charge,
      brand: brand,
      thickness: charge ? '' : String(r[3] === null ? '' : r[3]),
      length:    charge ? '' : String(r[5] === null ? '' : r[5]),
      breadth:   charge ? '' : String(r[6] === null ? '' : r[6]),
      sheets:    charge ? '' : String(r[7] === null ? '' : r[7]),
      rate:      charge ? '' : String(r[8] === null ? '' : r[8]),
      m2:        charge ? String(r[9] === null ? '' : r[9]) : '',
      rate_m2:   charge ? String(r[10] === null ? '' : r[10]) : '',
      description: String(r[15] || '')
    });
  }

  return {
    quoteNumber: quoteNumber,
    customer: String(vals[0][2] || ''),
    vehicle: vehicle,
    destination: destination,
    removeHandling: removeHandling,
    items: items
  };
}

/** Save an EDITED quote back onto its own number, in its own place. */
function updateQuote(quote) {
  if (!quote || !quote.lines || !quote.lines.length) throw new Error('Nothing to update.');
  var quoteNumber = parseInt(quote.quoteNumber, 10);
  if (!quoteNumber) throw new Error('No quote number to update.');
  if (quote.missing && quote.missing.length) {
    throw new Error('Add rates for: ' + quote.missing.join(', '));
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  if (!data) throw new Error('Tab "' + DATA_TAB + '" not found.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var loc = findQuoteRows_(data, quoteNumber);
    if (!loc.count) throw new Error('Quote #' + quoteNumber + ' not found in ' + DATA_TAB + '.');
    // Replace the old block with the new lines, keeping the same position.
    data.deleteRows(loc.firstRow, loc.count);
    data.insertRowsAfter(loc.firstRow - 1, quote.lines.length);
    writeQuoteRows_(data, loc.firstRow, quoteNumber, quote);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return {
    quoteNumber: quoteNumber,
    count: quote.lines.length,
    customer: quote.customer,
    orientation: quote.lines.length > LANDSCAPE_MAX_ITEMS ? 'portrait' : 'landscape'
  };
}

/** Step 2, called by the page right after the save: export the PDF.
 *  Kept separate so "Confirm & save" itself returns immediately. */
function makeQuotePdf(quoteNumber, count, customer) {
  return exportQuoteByNumber_(quoteNumber, count, customer);
}

/** Export a quote's PDF, fast AND never stale.
 *  Google's export endpoint can serve a snapshot of the spreadsheet from
 *  BEFORE our changes (it once produced the previous quote's PDF, and waiting
 *  it out took 30+ seconds). So we never export the main file: set H4, read
 *  the lookup tab's computed VALUES directly (Apps Script reads are always
 *  current), snapshot them into a brand-new temporary spreadsheet — which has
 *  no old version the export server could serve — export that, and delete it. */
function exportQuoteByNumber_(quoteNumber, count, customer) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var portrait = count > LANDSCAPE_MAX_ITEMS;
  var tabName = portrait ? LOOKUP_PORTRAIT_TAB : LOOKUP_LANDSCAPE_TAB;
  var tab = ss.getSheetByName(tabName);
  if (!tab) throw new Error('Tab "' + tabName + '" not found.');

  // Show the quote on the lookup tab and capture its computed values.
  var cell = tab.getRange(QUOTE_INPUT_CELL);
  var previous = cell.getValue();
  var values;
  cell.setValue(quoteNumber);
  SpreadsheetApp.flush();
  try {
    values = tab.getDataRange().getValues();
  } finally {
    cell.setValue(previous === '' ? '' : previous);
    SpreadsheetApp.flush();
  }

  // Snapshot into a fresh temp spreadsheet (same layout/formatting via copyTo,
  // formulas replaced by the captured values), export it, then delete it.
  var temp = SpreadsheetApp.create('tmp_quote_' + quoteNumber);
  try {
    var copy = tab.copyTo(temp);
    copy.getRange(1, 1, values.length, values[0].length).setValues(values);
    temp.deleteSheet(temp.getSheets()[0]); // the default empty Sheet1

    // The vehicle/destination cell under the buyer (A10) can hold two labelled
    // lines — let it wrap and give the row enough height to show both.
    if (values.length > 9 && String(values[9][0]).indexOf('\n') >= 0) {
      copy.getRange('A10').setWrap(true);
      copy.setRowHeight(10, 44);
    }
    SpreadsheetApp.flush();

    var fileName = 'Quote_' + quoteNumber + '_' + safeName_(customer) + '.pdf';
    var blob = exportTabPdf_(temp.getId(), copy.getSheetId(), portrait, fileName);
    var link = deliver_(blob);
    return { quoteNumber: quoteNumber, orientation: portrait ? 'portrait' : 'landscape', link: link };
  } finally {
    DriveApp.getFileById(temp.getId()).setTrashed(true);
  }
}

/** Bottom of the quote ledger, found via the THICKNESS column (E).
 *  Column E is filled on every real quote line — glass lines carry their mm,
 *  loading/transport lines carry 0 — and is blank only AFTER your quotes. (The
 *  quote# column C, by contrast, is filled far down the sheet, which is why it
 *  can't be used.) So: skip the leading rows (the brand drop-down list, which
 *  have E blank), then return the last row of the unbroken block of filled
 *  thickness cells — i.e. the row just before the first blank thickness row.
 *  New quotes then insert at that first blank row, right after your last quote.
 *  Returns 0 if no data. */
function lastLedgerRow_(data) {
  var last = data.getLastRow();
  if (last < FIRST_DATA_ROW) return 0;
  var e = data.getRange(FIRST_DATA_ROW, 5, last - FIRST_DATA_ROW + 1, 1).getValues();
  var started = false, bottom = 0;
  for (var i = 0; i < e.length; i++) {
    var v = e[i][0];
    var filled = (v !== '' && v !== null);
    if (filled) { started = true; bottom = FIRST_DATA_ROW + i; }
    else if (started) break; // first blank thickness after the data block = end
  }
  return bottom;
}

/** The QUOTATIONS calc formulas for a given row, keyed by column number.
 *  These mirror the sheet's own formulas (verified from the workbook). Written
 *  explicitly rather than cloned, because recent quote rows are stored as
 *  hardcoded values and the sheet's AC-column formula contains a #REF!.
 *  Columns: A=1 key, K=11 m², L=12 rate/m², M=13 handling, N=14 pre-tax,
 *  O=15 after-tax, P=16 invoice, R=18/S=19 rough, T=20 stock key,
 *  U..Z=21..26 stock lookups, AA=27 sum, AB=28 day-book, AD=30 mm/m². */
function ledgerFormulas_(r) {
  var a = FIRST_DATA_ROW; // running-count anchor row for the line-number key
  return {
    1:  '=IF(E' + r + '="","",C' + r + '&COUNTIF(C$' + a + ':C' + r + ',C' + r + '))',
    11: '=IF(J' + r + '=0,0,G' + r + '*H' + r + '*I' + r + '*10^-4)',
    12: '=E' + r + '*J' + r + '*0.84746',
    13: '=K' + r + '*L' + r + '*0.01',
    14: '=K' + r + '*L' + r + '+M' + r,
    15: '=N' + r + '*1.18',
    16: '=IFS(D' + r + '="",0,AC' + r + '=1,(IF(AND((AA' + r + '-AB' + r + ')<50,(AA' + r + '-AB' + r +
        ')>=(-50)),AB' + r + ',AA' + r + ')),AC' + r + '>1,0)',
    18: '=IF(Q' + r + '="","",IF(AND((AA' + r + '-AB' + r + ')<50,(AA' + r + '-AB' + r +
        ')>=(-50)),"",AB' + r + '))',
    19: '=IFERROR(IFS(R' + r + '="","",R' + r + '="bal",AB' + r + ',R' + r + '="HAR",AB' + r + ',R' +
        r + '="SAT",AB' + r + '),"")',
    20: '=E' + r + '&" "&F' + r + '&" "&G' + r + '&" "&H' + r,
    21: "=IFERROR(VLOOKUP(T" + r + ",'J STOCKBOOK'!A:C,2,FALSE),0)",
    22: "=IFERROR(VLOOKUP(T" + r + ",'J STOCKBOOK'!A:C,3,FALSE),0)",
    23: "=IFERROR(VLOOKUP(T" + r + ",'JP STOCKBOOK'!A:C,2,FALSE),0)",
    24: "=IFERROR(VLOOKUP(T" + r + ",'JP STOCKBOOK'!A:C,3,FALSE),0)",
    25: "=IFERROR(VLOOKUP(T" + r + ",'O STOCKBOOK'!A:C,2,FALSE),0)",
    26: "=IFERROR(VLOOKUP(T" + r + ",'O STOCKBOOK'!A:C,3,FALSE),0)",
    27: '=SUMIF(C:C,C' + r + ',O:O)',
    28: "=IFERROR(VLOOKUP(C" + r + ",'CONSOLIDATED DAY BOOK'!D:H,5,FALSE),AA" + r + ")",
    30: '=K' + r + '*E' + r
  };
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
  return exportQuoteByNumber_(quoteNumber, summary.count, summary.customer);
}

// ---- Tally billing queue ------------------------------------------------------
// The phone queues "make this bill in Tally" requests here; the office computer
// (which is where Tally actually runs) reads the queue, creates the voucher,
// prints the copies, optionally saves the bill to Documents, and marks it done.

/** The "Tally Bills" queue tab, created with headers on first use. */
function tallyTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = ss.getSheetByName(TALLY_TAB);
  if (!t) {
    t = ss.insertSheet(TALLY_TAB);
    t.getRange(1, 1, 1, 8).setValues([[
      'Requested', 'Quote #', 'Customer', 'Godown',
      'Print copies', 'Save to Documents', 'Status', 'Done / notes'
    ]]).setFontWeight('bold');
    t.setFrozenRows(1);
  }
  return t;
}

/** Godown suggestions for the form: every godown name used before, A→Z. */
function godownList_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = ss.getSheetByName(TALLY_TAB);
  if (!t || t.getLastRow() < 2) return [];
  var vals = t.getRange(2, 4, t.getLastRow() - 1, 1).getValues();
  var seen = {}, out = [];
  vals.forEach(function (r) {
    var s = String(r[0] == null ? '' : r[0]).trim();
    if (!s || seen[s.toLowerCase()]) return;
    seen[s.toLowerCase()] = 1; out.push(s);
  });
  out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  return out;
}

/** Called from the page: queue a Tally bill for an existing quote. */
function queueTallyBill(req) {
  var quoteNumber = parseInt(req && req.quoteNumber, 10);
  if (!quoteNumber) throw new Error('Enter a quote number.');
  var godown = String(req.godown || '').trim();
  if (!godown) throw new Error('Enter the godown name.');
  var copies = parseInt(req.copies, 10);
  if (isNaN(copies) || copies < 0 || copies > 20) copies = 1;
  var saveToDocs = !!req.saveToDocs;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  if (!data) throw new Error('Tab "' + DATA_TAB + '" not found.');
  var summary = summariseQuote_(data, quoteNumber);
  if (summary.count === 0) {
    throw new Error('Quote #' + quoteNumber + ' not found in ' + DATA_TAB + '.');
  }

  var t = tallyTab_();
  t.appendRow([new Date(), quoteNumber, summary.customer, godown,
               copies, saveToDocs ? 'YES' : 'NO', 'PENDING', '']);
  SpreadsheetApp.flush();

  // How many are now waiting, for the confirmation message.
  var pending = 0;
  if (t.getLastRow() >= 2) {
    t.getRange(2, 7, t.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (String(r[0]).trim().toUpperCase() === 'PENDING') pending++;
    });
  }
  return { quoteNumber: quoteNumber, customer: summary.customer, pending: pending };
}

/** Last few queued bills (newest first) so the page can show their status. */
function recentTallyBills(limit) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = ss.getSheetByName(TALLY_TAB);
  if (!t || t.getLastRow() < 2) return [];
  var n = t.getLastRow() - 1;
  var vals = t.getRange(2, 1, n, 8).getValues();
  var out = [];
  for (var i = n - 1; i >= 0 && out.length < (limit || 5); i--) {
    var r = vals[i];
    if (!r[1]) continue;
    out.push({
      requested: (r[0] instanceof Date) ? Utilities.formatDate(r[0], TIMEZONE, 'd MMM h:mm a') : String(r[0]),
      quote: r[1], customer: String(r[2] || ''), godown: String(r[3] || ''),
      copies: r[4], saveToDocs: String(r[5]).toUpperCase() === 'YES',
      status: String(r[6] || ''), note: String(r[7] || '')
    });
  }
  return out;
}

/** JSON API for the office computer (needs a deployment with access "Anyone"):
 *    ...?tally=pending&key=KEY          -> pending bills with full quote data
 *    ...?tally=done&key=KEY&row=N       -> mark row N done
 *      [&status=DONE|ERROR][&note=...]
 */
function tallyApi_(e) {
  var out;
  try {
    if (e.parameter.key !== TALLY_API_KEY) {
      out = { error: 'bad key' };
    } else if (e.parameter.tally === 'pending') {
      out = { bills: tallyPending_() };
    } else if (e.parameter.tally === 'done') {
      out = tallyDone_(e.parameter);
    } else {
      out = { error: 'unknown action "' + e.parameter.tally + '"' };
    }
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Every PENDING bill, expanded with the quote's items, party details, totals. */
function tallyPending_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = ss.getSheetByName(TALLY_TAB);
  if (!t || t.getLastRow() < 2) return [];
  var data = ss.getSheetByName(DATA_TAB);
  var custInfo = customerInfo_();
  var n = t.getLastRow() - 1;
  var vals = t.getRange(2, 1, n, 8).getValues();
  var out = [];
  for (var i = 0; i < n; i++) {
    var r = vals[i];
    if (String(r[6]).trim().toUpperCase() !== 'PENDING' || !r[1]) continue;
    var quoteNumber = parseInt(r[1], 10);
    var bill = {
      row: i + 2, // sheet row, for the mark-done call
      requested: (r[0] instanceof Date) ? Utilities.formatDate(r[0], TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss") : String(r[0]),
      quote: quoteNumber,
      godown: String(r[3] || ''),
      copies: parseInt(r[4], 10) || 1,
      saveToDocuments: String(r[5]).toUpperCase() === 'YES'
    };
    try {
      var q = loadQuote(quoteNumber);
      bill.customer = q.customer;
      bill.vehicle = q.vehicle;
      bill.destination = q.destination;
      bill.removeHandling = q.removeHandling;
      bill.items = q.items;
      var info = custInfo[(q.customer || '').trim().toLowerCase()];
      bill.address = info ? info.address : '';
      bill.gstin = info ? info.gstin : '';
      var loc = findQuoteRows_(data, quoteNumber);
      if (loc.count) bill.totals = quoteTotals_(data, loc);
    } catch (err) {
      bill.loadError = String((err && err.message) || err);
    }
    out.push(bill);
  }
  return out;
}

/** Taxable / CGST / SGST / Total for a quote's block, from its N (pre-tax) sum. */
function quoteTotals_(data, loc) {
  var nvals = data.getRange(loc.firstRow, 14, loc.count, 1).getValues(); // N
  var tax = 0;
  nvals.forEach(function (r) { var v = Number(r[0]); if (!isNaN(v)) tax += v; });
  return {
    taxable: round_(tax, 2),
    cgst: round_(tax * 0.09, 2),
    sgst: round_(tax * 0.09, 2),
    total: Math.round(tax * 1.18)
  };
}

/** Mark a queued bill done (or errored) — called by the office computer. */
function tallyDone_(p) {
  var row = parseInt(p.row, 10);
  var t = tallyTab_();
  if (!row || row < 2 || row > t.getLastRow()) throw new Error('Bad row "' + p.row + '".');
  var status = String(p.status || 'DONE').toUpperCase() === 'ERROR' ? 'ERROR' : 'DONE';
  var note = String(p.note || '');
  var stamp = Utilities.formatDate(new Date(), TIMEZONE, 'd MMM yyyy h:mm a');
  t.getRange(row, 7, 1, 2).setValues([[status, (note ? note + ' — ' : '') + stamp]]);
  SpreadsheetApp.flush();
  return { ok: true, row: row, status: status };
}

// ---- Helpers ----------------------------------------------------------------
function nextQuoteNumber_(dataSheet) {
  // Highest quote number within the real ledger (rows up to the thickness-column
  // bottom), plus 1. Restricting to the ledger ignores the stale quote numbers
  // that are filled far down column C below your quotes.
  var bottom = lastLedgerRow_(dataSheet);
  if (bottom < FIRST_DATA_ROW) return 1285;
  var col = dataSheet.getRange(FIRST_DATA_ROW, 3, bottom - FIRST_DATA_ROW + 1, 1).getValues();
  var max = 0;
  col.forEach(function (r) {
    var n = parseInt(r[0], 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max ? max + 1 : 1285;
}

/** Quotes for the on-screen history: newest first, one row per quote number
 *  with its customer, item count, total (₹) and a short items summary (brands,
 *  thickness and any additional description). Reads only the real ledger.
 *  limit <= 0 returns them all (for "view older quotes"). */
function recentQuotes(limit) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  if (!data) return [];
  var bottom = lastLedgerRow_(data);
  if (bottom < FIRST_DATA_ROW) return [];
  // B..Q (2..17): 1 C(quote#) 2 D(customer) 3 E(thk) 4 F(brand) 13 O(invoice) 15 Q(desc).
  var vals = data.getRange(FIRST_DATA_ROW, 2, bottom - FIRST_DATA_ROW + 1, 16).getValues();
  var map = {}, order = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var q = parseInt(r[1], 10);              // C
    var thk = r[3];                          // E — only real line rows have it
    if (isNaN(q) || thk === '' || thk === null) continue;
    if (!map[q]) { map[q] = { quote: q, customer: '', items: 0, total: 0, labels: [] }; order.push(q); }
    var g = map[q];
    g.items++;
    if (!g.customer && r[2]) g.customer = String(r[2]);   // D
    var o = parseFloat(r[13]);                            // O
    if (!isNaN(o)) g.total += o;
    // Full line label: size, sheets and rate too (not just brand/thickness).
    var brand = String(r[4] || '');                       // F
    var desc = String(r[15] || '');                       // Q
    var blank = function (v) { return v === '' || v === null || v === undefined; };
    var label;
    if (isChargeBrand_(brand)) {
      label = brand;                                      // loading / transport
      if (!blank(r[9])) label += ' ' + r[9] + 'm²';       // K m²
      if (!blank(r[10])) label += ' @' + r[10];           // L rate per m²
    } else {
      label = (blank(thk) ? '' : thk + 'mm ') + brand;    // E thickness + F brand
      if (!blank(r[5]) && !blank(r[6])) label += ' ' + r[5] + 'x' + r[6] + 'cm'; // G x H
      if (!blank(r[7])) label += ' ' + r[7] + 'sh';       // I sheets
      if (!blank(r[8])) label += ' @' + r[8];             // J rate
    }
    if (desc) label += ' (' + desc + ')';
    if (g.labels.length < 8) g.labels.push(label);
  }
  order.sort(function (a, b) { return b - a; }); // newest quote number first
  var lim = (limit && limit > 0) ? limit : order.length;
  var out = [];
  for (var k = 0; k < order.length && k < lim; k++) {
    var e = map[order[k]];
    out.push({
      quote: e.quote, customer: e.customer, items: e.items,
      total: Math.round(e.total), summary: e.labels.join(', ')
    });
  }
  return out;
}

function summariseQuote_(dataSheet, quoteNumber) {
  var last = dataSheet.getLastRow();
  var out = { count: 0, customer: '', date: '' };
  if (last < FIRST_DATA_ROW) return out;
  // Read B(date) C(quote#) D(customer) E(thickness). Count only real line rows
  // (thickness filled) — the quote# column is also filled on empty rows far
  // below the ledger, which must NOT be counted.
  var rows = dataSheet.getRange(FIRST_DATA_ROW, 2, last - FIRST_DATA_ROW + 1, 4).getValues();
  rows.forEach(function (r) {
    var hasLine = (r[3] !== '' && r[3] !== null);
    if (hasLine && parseInt(r[1], 10) === quoteNumber) {
      out.count++;
      if (!out.date) out.date = r[0];
      if (!out.customer) out.customer = r[2];
    }
  });
  return out;
}

function exportTabPdf_(spreadsheetId, gid, portrait, fileName) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' +
    'format=pdf' +
    '&gid=' + gid +
    '&portrait=' + (portrait ? 'true' : 'false') +
    '&size=A4' +
    '&scale=4' + // 4 = fit to page, so the whole quote is one page
    '&gridlines=true&printtitle=false&sheetnames=false&pagenumbers=false' + // gridlines give the ruled table lines
    '&top_margin=0.25&bottom_margin=0.25&left_margin=0.25&right_margin=0.25' +
    '&horizontal_alignment=CENTER&vertical_alignment=TOP';
  // A brand-new file can need a moment before the export endpoint serves it.
  var resp;
  for (var attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) Utilities.sleep(1500);
    resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() < 300) return resp.getBlob().setName(fileName);
  }
  throw new Error('PDF export failed (' + resp.getResponseCode() + ').');
}

/** Save the PDF in the "Rachna Quotes" Drive folder and return its link. */
function deliver_(blob) {
  var folders = DriveApp.getFoldersByName('Rachna Quotes');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Rachna Quotes');
  return folder.createFile(blob).getUrl();
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

/**
 * One-off diagnostic: run this from the editor (pick "diagnose" in the function
 * dropdown, click Run) and read the Execution log. It shows where the most
 * recent quote rows physically are in the QUOTATIONS tab.
 */
function diagnose() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(DATA_TAB);
  var last = data.getLastRow();
  var lastLedger = lastLedgerRow_(data);
  var c = data.getRange(1, 3, last, 1).getValues();
  var d = data.getRange(1, 4, last, 1).getValues();
  var e = data.getRange(1, 5, last, 1).getValues();
  var out = ['DATA_TAB=' + DATA_TAB, 'getLastRow=' + last,
             'lastLedgerRow (thickness-column bottom)=' + lastLedger,
             'quote# at that row=' + (lastLedger ? data.getRange(lastLedger, 3).getValue() : '-'),
             'next quote number=' + nextQuoteNumber_(data),
             'next insert would go to row ' + (lastLedger + 1),
             '--- bottom 12 ledger rows (thickness filled) ---'];
  var shown = 0;
  for (var r = lastLedger; r >= FIRST_DATA_ROW && shown < 12; r--) {
    if (e[r - 1][0] === '' || e[r - 1][0] === null) continue;
    out.push('row ' + r + ':  quote#=' + (c[r - 1][0] || '') +
             '  customer=' + (d[r - 1][0] || '') + '  thickness=' + e[r - 1][0]);
    shown++;
  }
  Logger.log(out.join('\n'));
  return out.join('\n');
}

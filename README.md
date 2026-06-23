# NCCRED — call recordings → glass quotes

Turn a recorded customer call into a new quote in the RACHNA ENTERPRISES
quotation sheet.

> **On a phone, no computer to run commands?** Use the in-sheet version instead:
> a "Make Quote" web page that lives inside your Google Sheet and runs from your
> phone. One-time setup (~15 min on a computer) is in
> [`apps_script/README.md`](apps_script/README.md). The Python tool below is for
> running on a Windows/Mac computer. The call is transcribed, the glass order is pulled out of the
(Kannada / Hindi / English) conversation, priced using your rate card, shown to
you for review, and — only when you approve — written into the workbook.

```
 call recording ──► transcript ──► glass line items ──► priced quote ──► PREVIEW
   (Google STT)      (text)         (Claude)            (your rates)        │
                                                                           │ you approve
                                                                           ▼
                                                                  row(s) in the sheet
```

> You don't have recordings yet — that's fine. Everything works from a text
> transcript too, so you can try the whole flow today with the sample call in
> `sample_data/`, and just point it at audio once you start recording.

---

## What's in here

| File | What it does |
|------|--------------|
| `nccred/transcribe.py` | Audio → text, via Google Speech-to-Text (Kannada + Hindi + English) |
| `nccred/extract.py` | Transcript → structured glass items, via Claude, matched to your brand catalog |
| `nccred/pricing.py` | The workbook's pricing formula (verified against quote #1284) |
| `nccred/sheets.py` | Reads the next quote number; appends approved quotes to the sheet |
| `nccred/pdf.py` | Exports the formatted quotation tab to a PDF (landscape or portrait) |
| `nccred/cli.py` | Runs the whole flow; **previews first, writes only on `--commit`** |
| `data/brands.txt` | Your glass brand/type catalog (pulled from the sheet) |
| `data/rates.csv` | Your rate card — **you fill this in** (only `4mm sg` is seeded) |
| `sample_data/sample_transcript.txt` | A fake call so you can test without a recording |

---

## Quick start (no recording needed)

```bash
pip install -r requirements.txt
cp .env.example .env        # then edit .env (see Setup below)

# Run the sample call through extraction + pricing. Preview only — writes nothing.
python -m nccred.cli --transcript sample_data/sample_transcript.txt
```

You'll see a preview like:

```
================================================================
  QUOTE PREVIEW  (nothing written yet)
================================================================
  Customer : Mithul Fab
  Date     : 24-June-26
  Quote #  : (assigned on commit)
----------------------------------------------------------------
  1. 4.0mm sg | 244.0 x 138.0 cm | 25 sheets
     area: 84.18 m^2
     rate 110.0/mm  GST 18.0%  -> taxable 31703.04  CGST 2853.27  SGST 2853.27  total ₹37410
----------------------------------------------------------------
  Taxable 31703.04   GRAND TOTAL ₹37410
================================================================
```

(Extraction needs your `ANTHROPIC_API_KEY`. Pricing and preview need nothing else.)

---

## Check your setup

Once you've filled in `.env` and shared the sheet, confirm everything is wired:

```bash
python -m nccred.cli --check
```

It verifies the packages are installed, the keys are present, the Anthropic API
answers, the service account can open the spreadsheet, and all the expected tabs
exist — printing PASS/FAIL for each (and the service-account email you need to
share the sheet with). No secrets are printed.

## Setup

### 1. Anthropic API key (for reading the call)
Get a key from the Anthropic Console and put it in `.env` as `ANTHROPIC_API_KEY`.

### 2. Google service account (for transcription + writing the sheet)
1. In Google Cloud Console, create (or pick) a project.
2. Enable **Cloud Speech-to-Text API** and **Google Sheets API**.
3. Create a **service account**, then create a **JSON key** for it. Download it.
4. Put the key's path in `.env` as `GOOGLE_APPLICATION_CREDENTIALS`.
5. Open the JSON key, copy the `client_email` (looks like
   `something@your-project.iam.gserviceaccount.com`), and **share the
   spreadsheet with that email as an Editor** — exactly like sharing with a
   colleague. This is what lets the tool write quotes back.

### 3. Tabs the tool uses
- **`QUOTATIONS`** — the one-quote-per-row data tab the tool appends to and reads
  from. This is the default; change it with `NCCRED_DATA_TAB` if you rename it.
- **`claude landscape` / `claude portrait`** — auto-show the latest quote; used
  for the PDF right after a commit.
- **`landscape` / `portrait`** — fetch any quote by number; used by `--pull`.
  Tell the tool which cell to type the quote number into via
  `NCCRED_QUOTE_INPUT_CELL` (see the PDF section below).

### 4. Rates
The tool **never invents a price**. A rate can come from either:

- **`data/rates.csv`** — a row per glass type/thickness (good for rates you quote
  often). Ships with only `4mm sg = 110`.
- **`--rate` at confirm time** — give the rate on the command line for that run,
  e.g. `--rate 'sg:4:110'` (or `--rate 'asahi mirror:5:130:18'` to also set GST).
  Repeat the flag for multiple items. This overrides the CSV for that run.

If a line still has no rate from either source, it's flagged `RATE MISSING` in the
preview and won't be committed until a rate is supplied.

---

## Using it with real calls

Record the call as an audio file. Short clips (≈ under a minute) can be passed
directly; longer calls should be uploaded to a Google Cloud Storage bucket and
referenced by their `gs://` URL (Google's transcription requires this for long
audio).

```bash
# Preview a quote from a recording (writes nothing):
python -m nccred.cli --audio gs://your-bucket/call-2026-06-23.flac

# Review the preview. If it looks right, write it to the sheet:
python -m nccred.cli --audio gs://your-bucket/call-2026-06-23.flac --commit
```

`--commit` is the only thing that writes to your live workbook, and it refuses
if any line is missing a rate. The quote number is taken automatically as one
past the highest number already on the tab.

### The PDF copy

PDFs come straight from your sheet's own formatted layout — the tool does not
recreate the design. The workbook has **two pairs** of print-ready tabs, landscape
for few items and portrait for many:

| Tabs | When used | How the quote gets there |
|------|-----------|--------------------------|
| `claude landscape` / `claude portrait` | right after committing a **new** quote | they auto-show the latest quote |
| `landscape` / `portrait` | **re-printing an older** quote | the tool types the quote number into a cell |

In both pairs: **8 line items or fewer → landscape, more than 8 → portrait.**

**New quote** — after `--commit`, the PDF is exported automatically from the
`claude landscape` / `claude portrait` tab and saved to
`output/quote_<number>_<customer>.pdf`.

**Re-print an old quote** — give the quote number, no call needed:

```bash
python -m nccred.cli --pull 1284
```

This reads the `QUOTATIONS` tab to count that quote's items (to pick the tab),
types `1284` into the lookup tab's input cell (**H4** by default), exports the
PDF, then puts the cell back as it was.

The input cell defaults to `H4`. Change it with `NCCRED_QUOTE_INPUT_CELL`, or use
`NCCRED_QUOTE_INPUT_CELL_LANDSCAPE` / `_PORTRAIT` if the two lookup tabs ever use
different cells.

Common flags: `--orientation landscape|portrait` forces the tab,
`NCCRED_PDF_LANDSCAPE_MAX_ITEMS` changes the cut-off, `--no-pdf` skips the export
after a commit. Tab names are configurable too (see `.env.example`).

You can also override the customer name (`--customer "Mithul Fab"`) or feed a
transcript you typed yourself (`--transcript-text "4mm sg 244x138 25 sheets"`).

---

## How the price is calculated

Reverse-engineered from quote #1284 and verified by the tests:

```
area_m2        = (length_cm/100) * (breadth_cm/100) * sheets
value_incl_gst = rate_per_mm × (1 + 1%) × thickness_mm × area_m2
total (₹)      = round(value_incl_gst)          # "Total In Rupees"
taxable        = value_incl_gst / (1 + GST%)    # "Taxable Amount"
CGST = SGST    = taxable × GST%/2
```

The `1%` surcharge and `18%` GST are configurable in `.env`.

Run the checks anytime with `pytest tests/`.

---

## Limitations / things to know

- **Speech-to-text isn't perfect**, especially on a noisy line in mixed
  languages. Always read the preview before committing — that's why preview is
  the default and writing is opt-in.
- **Rates are yours to maintain.** The tool reads prices from `data/rates.csv`;
  keep it current.
- **One quote = one or more rows.** Each glass item becomes its own row on the
  data tab, all sharing the quote number, date, and customer.
- Recordings and `.env` are git-ignored; don't commit customer audio or keys.

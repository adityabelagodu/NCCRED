# NCCRED — call recordings → glass quotes

Turn a recorded customer call into a new quote in the RACHNA ENTERPRISES
quotation sheet. The call is transcribed, the glass order is pulled out of the
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

### 3. Tell it which tab holds the quote rows
The workbook has a tab with one quote per row (columns `DATE`, `quote#`,
`Customer name`, `Thickness mm`, `Brand`, `Length`, `Breadth`, `No. of sheets`,
`Rate ...`). Open the sheet, note that tab's **exact name** from the bottom of
the window, and set `NCCRED_DATA_TAB` in `.env` to it (the default guess is
`Data`).

### 4. Fill in your rate card
`data/rates.csv` ships with only `4mm sg = 110`. Add a row for every glass
type/thickness you quote, using the same "Rate in mm (incl. GST)" number you'd
type onto a quotation today. The tool **never invents a price** — if a customer
asks for something not in this file, that line is flagged `RATE MISSING` in the
preview and won't be committed until you add the rate.

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

After a successful commit, the tool exports a **PDF of the quote** from your
sheet's own formatted layout — it does not recreate the design. Your workbook has
two print-ready quotation tabs:

- **`claude landscape`** — used when the quote has **8 line items or fewer**
- **`claude portrait`** — used when the quote has **more than 8 items** (the
  extra rows need the taller page)

The PDF lands in `output/` as `quote_<number>_<customer>.pdf`. Override the
choice with `--orientation landscape|portrait`, change the cut-off with
`NCCRED_PDF_LANDSCAPE_MAX_ITEMS`, or skip the PDF entirely with `--no-pdf`. The
tab names are configurable too (`NCCRED_PDF_LANDSCAPE_TAB`,
`NCCRED_PDF_PORTRAIT_TAB`) in case you rename them.

> This exports the tabs **as they currently stand** — it assumes they display the
> quote you just committed (they read from the data tab). It runs immediately
> after the commit so the sheet is up to date.

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

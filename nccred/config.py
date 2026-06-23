"""Configuration, loaded from environment variables (see .env.example)."""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # python-dotenv is optional; env vars may be set another way.
    pass

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# --- The quotation workbook -------------------------------------------------
# The spreadsheet you shared.
SPREADSHEET_ID = os.environ.get(
    "NCCRED_SPREADSHEET_ID", "1pGnEoZA6kaFr75BP0DBcAJtsF4EFKPic7CRhnabNqh0"
)
# The tab that holds one quote per row (columns: DATE, quote#, Customer name,
# Thickness mm, Brand, Length, Breadth, No. of sheets, Rate ...). Set this to the
# exact tab name in your workbook; see the README for how to find it.
DATA_TAB = os.environ.get("NCCRED_DATA_TAB", "Data")

# --- Catalog & rates --------------------------------------------------------
BRANDS_FILE = Path(os.environ.get("NCCRED_BRANDS_FILE", DATA_DIR / "brands.txt"))
RATES_FILE = Path(os.environ.get("NCCRED_RATES_FILE", DATA_DIR / "rates.csv"))

# --- Pricing knobs (derived from quote #1284) -------------------------------
# "Rate in Rs. per mm per m^2 (including GST), 1% extra" -> 1% surcharge.
RATE_EXTRA_PCT = float(os.environ.get("NCCRED_RATE_EXTRA_PCT", "1.0"))
DEFAULT_GST_PCT = float(os.environ.get("NCCRED_DEFAULT_GST_PCT", "18.0"))

# --- Anthropic (extraction) -------------------------------------------------
ANTHROPIC_MODEL = os.environ.get("NCCRED_ANTHROPIC_MODEL", "claude-opus-4-8")

# --- PDF output -------------------------------------------------------------
# The PDF is a direct export of a pre-formatted quotation tab in your workbook.
# Where the exported PDFs are saved.
PDF_OUTPUT_DIR = Path(os.environ.get("NCCRED_PDF_OUTPUT_DIR", ROOT / "output"))
# The two formatted quotation tabs in the sheet (one per orientation).
PDF_LANDSCAPE_TAB = os.environ.get("NCCRED_PDF_LANDSCAPE_TAB", "claude landscape")
PDF_PORTRAIT_TAB = os.environ.get("NCCRED_PDF_PORTRAIT_TAB", "claude portrait")
# Quotes with this many line items or fewer use the landscape tab; more -> portrait.
PDF_LANDSCAPE_MAX_ITEMS = int(os.environ.get("NCCRED_PDF_LANDSCAPE_MAX_ITEMS", "8"))

# --- Google Speech-to-Text (transcription) ----------------------------------
# Calls are Kannada / Hindi / English mix, so we transcribe with a primary
# language plus alternates.
STT_PRIMARY_LANGUAGE = os.environ.get("NCCRED_STT_PRIMARY_LANGUAGE", "kn-IN")
STT_ALTERNATE_LANGUAGES = [
    lang.strip()
    for lang in os.environ.get("NCCRED_STT_ALTERNATE_LANGUAGES", "hi-IN,en-IN").split(
        ","
    )
    if lang.strip()
]

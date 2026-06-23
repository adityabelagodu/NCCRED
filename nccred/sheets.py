"""Read from and append to the Google Sheets quotation workbook.

Auth: a Google service account with the Sheets API enabled, whose client email
has been shared into the spreadsheet (Editor). Point GOOGLE_APPLICATION_CREDENTIALS
at its JSON key. See the README.

We write one row per glass line into the data tab, all rows sharing the same
quote number / date / customer. Column layout (matching the workbook's data tab):

    A Vlookup | B DATE | C quote# | D Customer | E Thickness mm | F Brand |
    G Length(cm) | H Breadth(cm) | I No. of sheets | J Rate in mm (incl GST)

Nothing here runs until you explicitly commit (see cli.py); reads are safe.
"""

from __future__ import annotations

from . import config
from .models import Quote

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
# The PDF export endpoint (docs.google.com/.../export) needs a Drive read scope.
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# 1-based column index of the quote-number column on the data tab (C = 3).
QUOTE_NUMBER_COL = 3
# Where the first data row sits (row 1 is the header on the data tab).
FIRST_DATA_ROW = 2


def _credentials(scopes: list[str]):
    from google.oauth2 import service_account

    import os

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds_path:
        raise RuntimeError(
            "GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at your service "
            "account JSON key (see README)."
        )
    return service_account.Credentials.from_service_account_file(
        creds_path, scopes=scopes
    )


def _service():
    from googleapiclient.discovery import build

    return build(
        "sheets", "v4", credentials=_credentials(SCOPES), cache_discovery=False
    )


def get_sheet_gid(tab_title: str) -> int:
    """Look up a tab's numeric gid by its (case-insensitive) title."""
    svc = _service()
    meta = (
        svc.spreadsheets()
        .get(
            spreadsheetId=config.SPREADSHEET_ID,
            fields="sheets(properties(sheetId,title))",
        )
        .execute()
    )
    want = tab_title.strip().lower()
    for sheet in meta.get("sheets", []):
        props = sheet.get("properties", {})
        if str(props.get("title", "")).strip().lower() == want:
            return int(props["sheetId"])
    titles = [s.get("properties", {}).get("title") for s in meta.get("sheets", [])]
    raise RuntimeError(
        f"Tab {tab_title!r} not found in the workbook. Tabs present: {titles}"
    )


def _col_letter(index_1based: int) -> str:
    letters = ""
    n = index_1based
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def next_quote_number(default_start: int = 1285) -> int:
    """Highest existing quote number on the data tab, plus one.

    Defaults to 1285 (one past quote #1284 in the sample) when the column is
    empty or unreadable as numbers.
    """
    svc = _service()
    col = _col_letter(QUOTE_NUMBER_COL)
    rng = f"{config.DATA_TAB}!{col}{FIRST_DATA_ROW}:{col}"
    result = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=config.SPREADSHEET_ID, range=rng)
        .execute()
    )
    numbers: list[int] = []
    for row in result.get("values", []):
        if not row:
            continue
        try:
            numbers.append(int(float(str(row[0]).strip())))
        except (ValueError, TypeError):
            continue
    return (max(numbers) + 1) if numbers else default_start


# Column letters on the data tab (B DATE, C quote#, D Customer).
DATE_COL = 2
CUSTOMER_COL = 4


def read_cell(tab: str, a1_cell: str) -> str | None:
    """Read a single cell's displayed value, e.g. read_cell('landscape', 'C5')."""
    svc = _service()
    result = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=config.SPREADSHEET_ID, range=f"{tab}!{a1_cell}")
        .execute()
    )
    values = result.get("values", [])
    if values and values[0]:
        return values[0][0]
    return None


def write_cell(tab: str, a1_cell: str, value) -> None:
    """Write a single cell, e.g. write_cell('landscape', 'C5', 1284)."""
    svc = _service()
    svc.spreadsheets().values().update(
        spreadsheetId=config.SPREADSHEET_ID,
        range=f"{tab}!{a1_cell}",
        valueInputOption="USER_ENTERED",
        body={"values": [[value]]},
    ).execute()


def quote_summary(quote_number: int) -> dict:
    """Look up an existing quote on the data tab.

    Returns {"count": <line items>, "customer": <name>, "date": <date>}. count is
    0 if the quote number isn't found.
    """
    svc = _service()
    qcol = _col_letter(QUOTE_NUMBER_COL)
    dcol = _col_letter(DATE_COL)
    ccol = _col_letter(CUSTOMER_COL)
    # Read DATE..Customer (B:D) in one shot.
    rng = f"{config.DATA_TAB}!{dcol}{FIRST_DATA_ROW}:{ccol}"
    rows = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=config.SPREADSHEET_ID, range=rng)
        .execute()
        .get("values", [])
    )
    # In the B:D window, index 0 = DATE(B), 1 = quote#(C), 2 = Customer(D).
    count = 0
    customer = ""
    date = ""
    for row in rows:
        if len(row) < 2:
            continue
        try:
            row_quote = int(float(str(row[1]).strip()))
        except (ValueError, TypeError):
            continue
        if row_quote == quote_number:
            count += 1
            if not date and len(row) > 0:
                date = str(row[0]).strip()
            if not customer and len(row) > 2:
                customer = str(row[2]).strip()
    return {"count": count, "customer": customer, "date": date}


def _quote_to_rows(quote: Quote) -> list[list]:
    """One sheet row per priced line, columns A..J."""
    rows: list[list] = []
    for line in quote.lines:
        rows.append(
            [
                "",  # A Vlookup (workbook formula column; left blank)
                quote.date,  # B DATE
                quote.quote_number,  # C quote#
                quote.customer_name,  # D Customer name
                line.thickness_mm,  # E Thickness mm
                line.brand,  # F Brand
                line.length_cm,  # G Length (cm)
                line.breadth_cm,  # H Breadth (cm)
                line.sheets,  # I No. of sheets
                line.rate_per_mm_per_m2 or "",  # J Rate in mm (incl GST)
            ]
        )
    return rows


def append_quote(quote: Quote) -> dict:
    """Append the quote's rows to the data tab. Caller must set quote.quote_number."""
    if quote.quote_number is None:
        raise ValueError("quote.quote_number must be set before appending.")

    svc = _service()
    body = {"values": _quote_to_rows(quote)}
    return (
        svc.spreadsheets()
        .values()
        .append(
            spreadsheetId=config.SPREADSHEET_ID,
            range=f"{config.DATA_TAB}!A{FIRST_DATA_ROW}",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        )
        .execute()
    )

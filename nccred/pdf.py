"""Export a quote to PDF using the pre-formatted quotation tabs in the workbook.

Your sheet has two pairs of print-ready tabs (landscape = few items, portrait =
many items):

  * "claude landscape" / "claude portrait"  -- auto-show the LATEST quote.
        Used right after committing a new quote.
  * "landscape" / "portrait"                -- fetch ANY quote by number, typed
        into a cell. Used to re-print an older quote.

We don't recreate the layout; we ask Google Sheets to export the right tab.

Orientation is automatic from the item count (<= NCCRED_PDF_LANDSCAPE_MAX_ITEMS
-> landscape, else portrait); override with `orientation=`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from . import config
from .models import Quote

_EXPORT_URL = "https://docs.google.com/spreadsheets/d/{id}/export"


def _orientation(count: int, override: Optional[str]) -> str:
    if override in ("landscape", "portrait"):
        return override
    return "landscape" if count <= config.PDF_LANDSCAPE_MAX_ITEMS else "portrait"


def _safe_name(text: str) -> str:
    keep = [c if (c.isalnum() or c in "-_") else "_" for c in (text or "").strip()]
    return "".join(keep).strip("_") or "customer"


def _out_path(out_path, quote_number, customer) -> Path:
    if out_path is not None:
        p = Path(out_path)
    else:
        config.PDF_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        qn = quote_number if quote_number is not None else "draft"
        p = config.PDF_OUTPUT_DIR / f"quote_{qn}_{_safe_name(customer)}.pdf"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _export_tab(tab_title: str, mode: str, dest: Path) -> Path:
    """Export one tab of the workbook to a PDF at `dest`."""
    from google.auth.transport.requests import AuthorizedSession

    from . import sheets

    gid = sheets.get_sheet_gid(tab_title)
    params = {
        "format": "pdf",
        "gid": str(gid),
        "portrait": "true" if mode == "portrait" else "false",
        "size": "A4",
        "fitw": "true",  # scale to page width so nothing is clipped
        "gridlines": "false",
        "printtitle": "false",
        "sheetnames": "false",
        "horizontal_alignment": "CENTER",
    }
    session = AuthorizedSession(sheets._credentials(sheets.DRIVE_SCOPES))
    resp = session.get(
        _EXPORT_URL.format(id=config.SPREADSHEET_ID), params=params, timeout=60
    )
    resp.raise_for_status()
    if not resp.content.startswith(b"%PDF"):
        raise RuntimeError(
            "Google did not return a PDF (got "
            f"{resp.headers.get('content-type')!r}). Check the service account can "
            f"view the sheet and that the tab {tab_title!r} exists."
        )
    dest.write_bytes(resp.content)
    return dest


def export_latest_quote_pdf(
    quote: Quote, out_path=None, orientation: Optional[str] = None
) -> Path:
    """Export a just-committed quote from the 'claude landscape/portrait' tabs.

    These tabs auto-display the latest quote, so no quote number is fed in.
    """
    mode = _orientation(len(quote.lines), orientation)
    tab = (
        config.PDF_LATEST_LANDSCAPE_TAB
        if mode == "landscape"
        else config.PDF_LATEST_PORTRAIT_TAB
    )
    dest = _out_path(out_path, quote.quote_number, quote.customer_name)
    return _export_tab(tab, mode, dest)


def export_quote_by_number(
    quote_number: int, out_path=None, orientation: Optional[str] = None
) -> Path:
    """Re-print an existing quote: type its number into a lookup tab, then export.

    Reads the data tab to count the quote's items (to pick orientation) and grab
    the customer name. Restores the input cell to its previous value afterwards.
    """
    from . import sheets

    summary = sheets.quote_summary(quote_number)
    if summary["count"] == 0:
        raise RuntimeError(
            f"Quote #{quote_number} was not found on the '{config.DATA_TAB}' tab."
        )

    mode = _orientation(summary["count"], orientation)
    if mode == "landscape":
        tab = config.PDF_LOOKUP_LANDSCAPE_TAB
        cell = config.QUOTE_INPUT_CELL_LANDSCAPE
    else:
        tab = config.PDF_LOOKUP_PORTRAIT_TAB
        cell = config.QUOTE_INPUT_CELL_PORTRAIT

    if not cell:
        raise RuntimeError(
            "No input cell configured for the lookup tabs. Set "
            "NCCRED_QUOTE_INPUT_CELL (e.g. 'C5') so I know where to type the quote "
            "number on the 'landscape'/'portrait' tabs."
        )

    previous = sheets.read_cell(tab, cell)
    sheets.write_cell(tab, cell, quote_number)
    try:
        dest = _out_path(out_path, quote_number, summary["customer"])
        return _export_tab(tab, mode, dest)
    finally:
        # Put the cell back the way we found it, so the tab isn't left changed.
        sheets.write_cell(tab, cell, previous if previous is not None else "")

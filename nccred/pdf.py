"""Export a confirmed quote to PDF using the pre-formatted tabs in the workbook.

Your sheet already contains two print-ready quotation tabs — one laid out for
landscape, one for portrait. We don't recreate that layout; we ask Google Sheets
to export the right tab as a PDF.

Orientation is automatic: short quotes use the landscape tab, quotes with many
line items use the portrait tab. Override with `orientation=`.

This assumes "export the tab as-is" — i.e. those tabs already display the quote
you just confirmed (they pull from the data tab). Run it right after committing.

Auth: the same service account used for the sheet, with Drive read scope, so the
account must have at least view access to the spreadsheet (it already has Editor
access from sharing).
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from . import config
from .models import Quote

_EXPORT_URL = "https://docs.google.com/spreadsheets/d/{id}/export"


def orientation_for(quote: Quote, orientation: Optional[str]) -> str:
    if orientation in ("landscape", "portrait"):
        return orientation
    return (
        "landscape"
        if len(quote.lines) <= config.PDF_LANDSCAPE_MAX_ITEMS
        else "portrait"
    )


def _safe_name(text: str) -> str:
    keep = [c if (c.isalnum() or c in "-_") else "_" for c in text.strip()]
    return "".join(keep).strip("_") or "customer"


def export_quote_pdf(
    quote: Quote,
    out_path: str | Path | None = None,
    orientation: Optional[str] = None,
) -> Path:
    """Export the appropriate formatted tab to a PDF and return its path."""
    from google.auth.transport.requests import AuthorizedSession

    from . import sheets

    mode = orientation_for(quote, orientation)
    tab = config.PDF_LANDSCAPE_TAB if mode == "landscape" else config.PDF_PORTRAIT_TAB
    gid = sheets.get_sheet_gid(tab)

    if out_path is None:
        config.PDF_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        qn = quote.quote_number if quote.quote_number is not None else "draft"
        fname = f"quote_{qn}_{_safe_name(quote.customer_name)}.pdf"
        out_path = config.PDF_OUTPUT_DIR / fname
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    params = {
        "format": "pdf",
        "gid": str(gid),
        # The tab is already designed for its orientation; set the page to match.
        "portrait": "true" if mode == "portrait" else "false",
        "size": "A4",
        "fitw": "true",  # scale to page width so nothing is clipped
        "gridlines": "false",
        "printtitle": "false",
        "sheetnames": "false",
        "horizontal_alignment": "CENTER",
    }

    creds = sheets._credentials(sheets.DRIVE_SCOPES)
    session = AuthorizedSession(creds)
    resp = session.get(
        _EXPORT_URL.format(id=config.SPREADSHEET_ID), params=params, timeout=60
    )
    resp.raise_for_status()
    if not resp.content.startswith(b"%PDF"):
        raise RuntimeError(
            "Google did not return a PDF (got "
            f"{resp.headers.get('content-type')!r}). Check that the service account "
            "can view the sheet and that the tab name is correct."
        )

    out_path.write_bytes(resp.content)
    return out_path

"""End-to-end: a call recording (or transcript) -> a previewed quote -> the sheet.

Preview first, commit on confirmation. Nothing is written to your live workbook
unless you pass --commit (and there are no missing rates).

Examples:
    # Run the sample transcript through extraction + pricing (no audio, no write):
    python -m nccred.cli --transcript sample_data/sample_transcript.txt

    # A real recording in Cloud Storage, preview only:
    python -m nccred.cli --audio gs://my-bucket/call-2026-06-23.flac

    # Same, and write the quote to the sheet once you've reviewed it:
    python -m nccred.cli --audio gs://my-bucket/call.flac --commit
"""

from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path

from . import config
from .models import Quote


def _today_sheet_format() -> str:
    """Date like '24-June-26' to match the workbook."""
    today = _dt.date.today()
    return f"{today.day}-{today.strftime('%B')}-{today.strftime('%y')}"


def _format_preview(quote: Quote) -> str:
    lines = []
    lines.append("=" * 64)
    lines.append("  QUOTE PREVIEW  (nothing written yet)")
    lines.append("=" * 64)
    lines.append(f"  Customer : {quote.customer_name or '(not captured)'}")
    lines.append(f"  Date     : {quote.date}")
    qn = quote.quote_number if quote.quote_number is not None else "(assigned on commit)"
    lines.append(f"  Quote #  : {qn}")
    lines.append("-" * 64)
    for i, line in enumerate(quote.lines, 1):
        lines.append(
            f"  {i}. {line.thickness_mm}mm {line.brand} | "
            f"{line.length_cm} x {line.breadth_cm} cm | {line.sheets} sheets"
        )
        lines.append(f"     area: {line.area_m2} m^2")
        if line.rate_missing:
            lines.append(
                "     !! RATE MISSING — add a row to data/rates.csv for "
                f"({line.brand}, {line.thickness_mm}mm), then re-run."
            )
        else:
            lines.append(
                f"     rate {line.rate_per_mm_per_m2}/mm  GST {line.gst_pct}%  "
                f"-> taxable {line.taxable}  CGST {line.cgst}  SGST {line.sgst}  "
                f"total ₹{line.total:.0f}"
            )
        if line.notes:
            lines.append(f"     note: {line.notes}")
    lines.append("-" * 64)
    if quote.has_missing_rates:
        lines.append("  TOTAL: incomplete (fill missing rates above)")
    else:
        lines.append(
            f"  Taxable {quote.taxable_total}   GRAND TOTAL ₹{quote.grand_total}"
        )
    lines.append("=" * 64)
    return "\n".join(lines)


def _get_transcript(args) -> str:
    if args.transcript_text:
        return args.transcript_text
    if args.transcript:
        return Path(args.transcript).read_text(encoding="utf-8")
    if args.audio:
        from .transcribe import transcribe

        print(f"Transcribing {args.audio} ...", file=sys.stderr)
        return transcribe(args.audio)
    raise SystemExit("Provide one of --audio, --transcript, or --transcript-text.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    src = parser.add_argument_group("input (choose one)")
    src.add_argument("--audio", help="Audio file path or gs:// URI of a call recording")
    src.add_argument("--transcript", help="Path to a text transcript")
    src.add_argument("--transcript-text", help="A transcript passed inline as a string")
    parser.add_argument(
        "--customer", help="Override the customer name (else taken from the call)"
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="After preview, write the quote to the live sheet (refused if rates missing)",
    )
    args = parser.parse_args(argv)

    transcript = _get_transcript(args)
    if not transcript.strip():
        raise SystemExit("Empty transcript — nothing to quote.")

    from .extract import extract_line_items
    from .pricing import build_quote

    customer_name, items = extract_line_items(transcript)
    if args.customer:
        customer_name = args.customer
    if not items:
        raise SystemExit("No glass items found in the call.")

    quote = build_quote(customer_name, _today_sheet_format(), items)
    print(_format_preview(quote))

    if not args.commit:
        print(
            "\nPreview only. Re-run with --commit to write this quote to the sheet.",
            file=sys.stderr,
        )
        return 0

    if quote.has_missing_rates:
        print(
            "\nRefusing to commit: some lines have no rate. Fill data/rates.csv first.",
            file=sys.stderr,
        )
        return 1

    from . import sheets

    quote.quote_number = sheets.next_quote_number()
    sheets.append_quote(quote)
    print(
        f"\nCommitted quote #{quote.quote_number} "
        f"({len(quote.lines)} line(s)) to the sheet."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

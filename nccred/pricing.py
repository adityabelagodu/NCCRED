"""Work out the money for each line, matching the workbook's formula.

Derived from quote #1284 (4 mm sg, 244 x 138 cm, 25 sheets, rate 110, 18% GST,
total ₹37,410):

    area_m2          = (length_cm / 100) * (breadth_cm / 100) * sheets
    value_incl_gst   = rate_per_mm_per_m2 * (1 + extra%) * thickness_mm * area_m2
    total            = round(value_incl_gst)            # "Total In Rupees"
    taxable          = value_incl_gst / (1 + gst%)      # "Taxable Amount"
    cgst = sgst      = taxable * (gst% / 2)             # split half/half

`extra%` is the workbook's "1% extra"; `gst%` defaults to 18%.
"""

from __future__ import annotations

from . import config
from .catalog import load_rates, lookup_rate
from .models import LineItem, PricedLine, Quote


def price_line(line: LineItem, rates: dict) -> PricedLine:
    """Price a single line. If no rate is on file, flag it and leave money at 0."""
    rate_info = lookup_rate(line.brand, line.thickness_mm, rates)

    area_m2 = (line.length_cm / 100.0) * (line.breadth_cm / 100.0) * line.sheets

    if rate_info is None:
        return PricedLine(
            thickness_mm=line.thickness_mm,
            brand=line.brand,
            length_cm=line.length_cm,
            breadth_cm=line.breadth_cm,
            sheets=line.sheets,
            notes=line.notes,
            area_m2=round(area_m2, 4),
            rate_missing=True,
        )

    rate = rate_info["rate"]
    gst_pct = rate_info["gst_pct"]
    value_incl = rate * (1 + config.RATE_EXTRA_PCT / 100.0) * line.thickness_mm * area_m2
    total = round(value_incl)
    taxable = value_incl / (1 + gst_pct / 100.0)
    half_gst = taxable * (gst_pct / 100.0) / 2.0

    return PricedLine(
        thickness_mm=line.thickness_mm,
        brand=line.brand,
        length_cm=line.length_cm,
        breadth_cm=line.breadth_cm,
        sheets=line.sheets,
        rate_per_mm_per_m2=rate,
        gst_pct=gst_pct,
        notes=line.notes,
        area_m2=round(area_m2, 4),
        taxable=round(taxable, 2),
        cgst=round(half_gst, 2),
        sgst=round(half_gst, 2),
        total=float(total),
        rate_missing=False,
    )


def build_quote(
    customer_name: str, date: str, lines: list[LineItem], rates: dict | None = None
) -> Quote:
    """Price every line and assemble a Quote (quote number assigned at commit)."""
    rates = rates if rates is not None else load_rates()
    priced = [price_line(line, rates) for line in lines]
    return Quote(customer_name=customer_name, date=date, lines=priced)

"""Pricing checks, anchored to quote #1284 in the workbook."""

from nccred.models import LineItem
from nccred.pricing import price_line

# 4 mm sg, 244 x 138 cm, 25 sheets, rate 110, 18% GST.
RATES = {("sg", 4.0): {"rate": 110.0, "gst_pct": 18.0}}


def test_quote_1284_totals():
    line = LineItem(
        thickness_mm=4, brand="sg", length_cm=244, breadth_cm=138, sheets=25
    )
    priced = price_line(line, RATES)

    # area = 2.44 * 1.38 * 25 = 84.18 m^2
    assert abs(priced.area_m2 - 84.18) < 0.01
    # Grand total rounds to the ₹37,410 on the real quote.
    assert priced.total == 37410
    # Taxable and GST split match the sheet to the rupee.
    assert abs(priced.taxable - 31703.0) < 2.0
    assert abs(priced.cgst - priced.sgst) < 0.01
    assert abs(priced.cgst - 2853.0) < 1.0


def test_missing_rate_is_flagged():
    line = LineItem(
        thickness_mm=12, brand="unobtanium", length_cm=100, breadth_cm=100, sheets=1
    )
    priced = price_line(line, RATES)
    assert priced.rate_missing is True
    assert priced.total == 0.0


def test_case_insensitive_brand():
    line = LineItem(
        thickness_mm=4, brand="SG", length_cm=244, breadth_cm=138, sheets=25
    )
    priced = price_line(line, RATES)
    assert priced.rate_missing is False
    assert priced.total == 37410

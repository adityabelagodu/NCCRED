"""Data shapes passed between pipeline stages."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class LineItem:
    """One glass item a customer asked for, as extracted from the call."""

    thickness_mm: float
    brand: str
    length_cm: float
    breadth_cm: float
    sheets: int
    # Filled in by pricing from the rate card; None until then.
    rate_per_mm_per_m2: Optional[float] = None
    gst_pct: Optional[float] = None
    # How confident the brand/spec match was, for the human reviewing the preview.
    notes: str = ""


@dataclass
class PricedLine(LineItem):
    """A line item with the money worked out."""

    area_m2: float = 0.0
    taxable: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    total: float = 0.0
    rate_missing: bool = False


@dataclass
class Quote:
    """A full quotation ready to preview or write to the sheet."""

    customer_name: str
    date: str  # e.g. "24-June-26", matching the sheet's format
    quote_number: Optional[int] = None  # assigned from the sheet at commit time
    lines: list[PricedLine] = field(default_factory=list)

    @property
    def taxable_total(self) -> float:
        return round(sum(line.taxable for line in self.lines), 2)

    @property
    def cgst_total(self) -> float:
        return round(sum(line.cgst for line in self.lines), 2)

    @property
    def sgst_total(self) -> float:
        return round(sum(line.sgst for line in self.lines), 2)

    @property
    def grand_total(self) -> float:
        return round(sum(line.total for line in self.lines))

    @property
    def has_missing_rates(self) -> bool:
        return any(line.rate_missing for line in self.lines)

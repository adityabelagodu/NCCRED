"""Load the brand catalog and the rate card."""

from __future__ import annotations

import csv
from pathlib import Path

from . import config


def load_brands(path: Path | None = None) -> list[str]:
    """Return the list of known glass brand/type strings."""
    path = path or config.BRANDS_FILE
    brands: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        brands.append(line)
    return brands


def load_rates(path: Path | None = None) -> dict[tuple[str, float], dict]:
    """Return {(brand_lower, thickness_mm): {"rate":..., "gst_pct":...}}."""
    path = path or config.RATES_FILE
    rates: dict[tuple[str, float], dict] = {}
    with path.open(encoding="utf-8") as fh:
        # Skip comment lines so the file can carry instructions for the user.
        rows = (line for line in fh if not line.lstrip().startswith("#"))
        reader = csv.DictReader(rows)
        for row in reader:
            if not row.get("brand"):
                continue
            key = (row["brand"].strip().lower(), float(row["thickness_mm"]))
            rates[key] = {
                "rate": float(row["rate_per_mm_per_m2"]),
                "gst_pct": float(row.get("gst_pct") or config.DEFAULT_GST_PCT),
            }
    return rates


def lookup_rate(
    brand: str, thickness_mm: float, rates: dict[tuple[str, float], dict]
) -> dict | None:
    """Find a rate for (brand, thickness), case-insensitive on brand."""
    return rates.get((brand.strip().lower(), float(thickness_mm)))

"""Turn a (multilingual) call transcript into structured glass line items.

Uses Claude to read a Kannada/Hindi/English transcript, pull out each glass item
the customer asked for, normalise units to centimetres, and match the spoken
brand to the closest entry in the catalog. Claude never invents a price — only
the specs the customer stated.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from . import config
from .catalog import load_brands
from .models import LineItem


class _ExtractedItem(BaseModel):
    thickness_mm: float = Field(description="Glass thickness in millimetres")
    brand: str = Field(
        description="Closest matching brand/type from the supplied catalog"
    )
    length_cm: float = Field(description="Length in centimetres")
    breadth_cm: float = Field(description="Breadth/width in centimetres")
    sheets: int = Field(description="Number of sheets requested")
    notes: str = Field(
        default="",
        description="Short note on any assumption, unit conversion, or low-confidence match",
    )


class _Extraction(BaseModel):
    customer_name: str = Field(
        description="Buyer/company name if stated, else empty string"
    )
    items: List[_ExtractedItem]


_SYSTEM = """You extract glass orders from customer phone-call transcripts for a \
glass wholesaler in Bangalore (RACHNA ENTERPRISES). Transcripts are a mix of \
Kannada, Hindi and English and may be rough (speech-to-text).

Rules:
- Output one item per distinct glass product the customer wants to buy.
- thickness is in millimetres (mm). "4 mm", "char mm", "4 number" -> 4.
- length and breadth must be in CENTIMETRES. Convert if the customer speaks in \
feet or inches (1 foot = 30.48 cm, 1 inch = 2.54 cm) and say so in notes.
- Match the spoken brand/type to the SINGLE closest entry in the catalog you are \
given. Use a real glass product, never a bookkeeping label (freight, damage, \
cutting, loading, etc.). If unsure, pick the nearest plain product (e.g. bare \
"sg", "asahi", "ggl") and explain in notes.
- "sheets" is the quantity of sheets. "ek peti"/"one case" is NOT a sheet count \
- if the customer gives cases instead of sheets, put the spoken quantity in \
sheets and flag it in notes.
- Do not guess or output prices. Only the specs the customer actually stated.
- If a value is genuinely missing, make your best inference and flag it in notes.
"""


def extract_line_items(transcript: str) -> tuple[str, list[LineItem]]:
    """Return (customer_name, [LineItem, ...]) extracted from the transcript."""
    import anthropic

    brands = load_brands()
    catalog_block = "\n".join(brands)

    client = anthropic.Anthropic()
    user_content = (
        "Glass brand/type catalog (match against these exactly):\n"
        f"{catalog_block}\n\n"
        "Call transcript:\n"
        f"{transcript}\n\n"
        "Extract the customer name and every glass item ordered."
    )

    response = client.messages.parse(
        model=config.ANTHROPIC_MODEL,
        max_tokens=8000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_content}],
        output_format=_Extraction,
    )

    data = response.parsed_output
    if data is None:
        raise RuntimeError(
            "Extraction failed: model did not return a valid result "
            f"(stop_reason={response.stop_reason})."
        )

    items = [
        LineItem(
            thickness_mm=item.thickness_mm,
            brand=item.brand,
            length_cm=item.length_cm,
            breadth_cm=item.breadth_cm,
            sheets=item.sheets,
            notes=item.notes,
        )
        for item in data.items
    ]
    return data.customer_name, items

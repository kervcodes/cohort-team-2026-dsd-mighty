"""Test data modelled on a real utility bill. Helpers, not tests."""

import io
from datetime import date
from typing import Any

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from backend.extraction.schema import (
    BillExtraction,
    Confidence,
    DocumentType,
    Extracted,
    LineItem,
)

TODAY = date(2026, 10, 29)

TEXT_LAYER = """
Brightwater Utilities
Statement date: 2026-10-20          Invoice # BW-4471-2611
Account Number 88-2110-4471
Service address: 2110 Example Ave, Dallas, TX 75201
Service period 2026-09-13 to 2026-10-12
Previous balance 1520.00
Payment received 1520.00
Water service 5000.00
Sewer service 680.00
Current charges 5680.00
Due date 2026-11-10
Total amount due 5680.00
"""


def ex(
    value: str | None,
    evidence: str | None = None,
    confidence: Confidence = Confidence.high,
) -> Extracted:
    """A field; evidence defaults to the value itself, or empty when null."""
    if evidence is None:
        evidence = value or ""
    return Extracted(value=value, evidence=evidence, confidence=confidence)


def null() -> Extracted:
    return ex(None)


def clean_extraction(**overrides: Any) -> BillExtraction:
    """A clean invoice whose evidence is all present in TEXT_LAYER."""
    fields: dict[str, Any] = {
        "document_type": DocumentType.invoice,
        "vendor_name": ex("Brightwater Utilities"),
        "account_number": ex("88-2110-4471"),
        "invoice_number": ex("BW-4471-2611", "Invoice # BW-4471-2611"),
        "invoice_date": ex("2026-10-20"),
        "due_date": ex("2026-11-10"),
        "amount_due": ex("5680.00"),
        "previous_balance": ex("1520.00"),
        "payments_received": ex("1520.00"),
        "current_charges": ex("5680.00"),
        "line_items": [
            LineItem(
                description=ex("Water service"),
                amount=ex("5000.00", "Water service 5000.00"),
            ),
            LineItem(
                description=ex("Sewer service"),
                amount=ex("680.00", "Sewer service 680.00"),
            ),
        ],
        "service_address": ex("2110 Example Ave, Dallas, TX 75201"),
        "service_period_start": ex("2026-09-13"),
        "service_period_end": ex("2026-10-12"),
    }
    fields.update(overrides)
    return BillExtraction(**fields)


def not_an_invoice() -> BillExtraction:
    return BillExtraction(
        document_type=DocumentType.not_an_invoice,
        vendor_name=null(),
        account_number=null(),
        invoice_number=null(),
        invoice_date=null(),
        due_date=null(),
        amount_due=null(),
        previous_balance=null(),
        payments_received=null(),
        current_charges=null(),
        line_items=[],
        service_address=null(),
        service_period_start=null(),
        service_period_end=null(),
    )


def _pdf_string(line: str) -> bytes:
    escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"({escaped}) Tj T*".encode("latin-1")


def make_pdf(text: str = TEXT_LAYER, pages: int = 1) -> bytes:
    """A real PDF whose text layer is `text` on every page (Helvetica)."""
    writer = PdfWriter()
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    lines = b" ".join(_pdf_string(line) for line in text.strip().splitlines())
    for _ in range(pages):
        page = writer.add_blank_page(612, 792)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 10 Tf 12 TL 50 750 Td " + lines + b" ET")
        page.replace_contents(content)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()

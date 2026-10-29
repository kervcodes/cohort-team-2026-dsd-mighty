"""Output schema for AI bill extraction (DC-52).

`BillExtraction` is what the model returns: every field is `{value, evidence,
confidence}` and every value is a string (amounts as decimal strings, dates as
`YYYY-MM-DD`) so the same JSON schema works with Claude and Gemini structured
output. Parsing into `Decimal` and `date` happens in code, in this module and in
`checks.py`, never in the model.

This module must not import Supabase: the extractor never touches the database
(see ENFORCEMENT.md).
"""

import re
from collections.abc import Iterator, Sequence
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

MAX_TEXT_LENGTH = 2000  # BillCreate.description / processing_notes limit


class Confidence(StrEnum):
    high = "high"
    medium = "medium"
    low = "low"

    @property
    def rank(self) -> int:
        return _CONFIDENCE_RANK[self]


_CONFIDENCE_RANK = {Confidence.low: 0, Confidence.medium: 1, Confidence.high: 2}


class DocumentType(StrEnum):
    invoice = "invoice"
    not_an_invoice = "not_an_invoice"


class Extracted(BaseModel):
    """One extracted value with the text it came from."""

    model_config = ConfigDict(extra="forbid")

    value: str | None = Field(
        description="The value, or null when the bill does not show it."
    )
    evidence: str = Field(
        description="Exact text copied from the bill; empty when value is null."
    )
    confidence: Confidence


class LineItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Extracted
    amount: Extracted


class BillExtraction(BaseModel):
    """The model output. Field names and meaning follow the DC-52 spec."""

    model_config = ConfigDict(extra="forbid")

    document_type: DocumentType
    vendor_name: Extracted
    account_number: Extracted
    invoice_number: Extracted
    invoice_date: Extracted
    due_date: Extracted
    amount_due: Extracted
    previous_balance: Extracted
    payments_received: Extracted
    current_charges: Extracted
    line_items: list[LineItem]
    service_address: Extracted
    service_period_start: Extracted
    service_period_end: Extracted

    def iter_fields(self) -> Iterator[tuple[str, Extracted]]:
        """Every `Extracted` in the output, line items as `line_items[i].amount`."""
        for name in FIELD_NAMES:
            yield name, getattr(self, name)
        for i, item in enumerate(self.line_items):
            yield f"line_items[{i}].description", item.description
            yield f"line_items[{i}].amount", item.amount


# Top-level fields of type `Extracted`, in schema order.
FIELD_NAMES = tuple(
    name
    for name, info in BillExtraction.model_fields.items()
    if info.annotation is Extracted
)
REQUIRED_FIELDS = (
    "vendor_name",
    "account_number",
    "invoice_number",
    "due_date",
    "amount_due",
)
DATE_FIELDS = (
    "invoice_date",
    "due_date",
    "service_period_start",
    "service_period_end",
)
AMOUNT_FIELDS = (
    "amount_due",
    "previous_balance",
    "payments_received",
    "current_charges",
)


class IssueCode(StrEnum):
    MISSING_REQUIRED = "MISSING_REQUIRED"
    BAD_DATE = "BAD_DATE"
    DUE_BEFORE_INVOICE = "DUE_BEFORE_INVOICE"
    DATE_OUT_OF_RANGE = "DATE_OUT_OF_RANGE"
    BAD_AMOUNT = "BAD_AMOUNT"
    LINE_ITEMS_MISMATCH = "LINE_ITEMS_MISMATCH"
    BALANCE_MISMATCH = "BALANCE_MISMATCH"
    EVIDENCE_NOT_FOUND = "EVIDENCE_NOT_FOUND"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"


class Issue(BaseModel):
    """A failed check. Messages never contain extracted values."""

    code: IssueCode
    field: str
    message: str


class ExtractionStatus(StrEnum):
    failed = "failed"
    not_an_invoice = "not_an_invoice"
    needs_attention = "needs_attention"
    ready_for_review = "ready_for_review"


class ExtractionResult(BaseModel):
    """What `extract_bill` returns and `POST /bills/extract` will serve."""

    status: ExtractionStatus
    extraction: BillExtraction | None = None
    issues: list[Issue] = Field(default_factory=list)
    failed_reason: str | None = None  # set when status is failed
    model: str | None = None
    prompt_version: str | None = None
    file_sha256: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    latency_ms: int | None = None


# Parsing. Shared by checks and by the BillCreate mapping so both agree on what
# counts as a valid date or amount.

_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_AMOUNT_RE = re.compile(r"-?\$?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?")
_CENTS = Decimal("0.01")
_MAX_INTEGER_DIGITS = 10  # 12 digits in total, 2 of them decimals


def parse_date(text: str | None) -> date | None:
    """Strict `YYYY-MM-DD`; anything else (including `20261020`) is None."""
    if text is None:
        return None
    text = text.strip()
    if not _DATE_RE.fullmatch(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def parse_amount(text: str | None) -> Decimal | None:
    """Parse a decimal string exactly. Tolerates a leading `$` and thousands commas.

    Returns None for anything non-numeric, including `NaN`, exponents and badly
    grouped commas such as `1,18`.
    """
    if text is None:
        return None
    text = text.strip()
    if not _AMOUNT_RE.fullmatch(text):
        return None
    return Decimal(text.replace("$", "").replace(",", ""))


def fits_money(amount: Decimal) -> bool:
    """At most 12 digits with 2 decimals, like `Money` in `schemas/bill.py`."""
    if not amount.is_finite():
        return False
    _, digits, exponent = amount.as_tuple()
    assert isinstance(exponent, int)  # narrowed by is_finite
    digits_list = list(digits)
    while exponent < 0 and len(digits_list) > 1 and digits_list[-1] == 0:
        digits_list.pop()
        exponent += 1
    places = max(-exponent, 0)
    integer_digits = max(len(digits_list) + exponent, 0)
    return places <= 2 and integer_digits <= _MAX_INTEGER_DIGITS


def _money(text: str | None, *, minimum_exclusive: bool) -> Decimal | None:
    amount = parse_amount(text)
    if amount is None or not fits_money(amount):
        return None
    if amount < 0 or (minimum_exclusive and amount == 0):
        return None
    return amount.quantize(_CENTS)


def _clean(field: Extracted) -> str | None:
    if field.value is None:
        return None
    return field.value.strip() or None


def _description(
    vendor: str | None, start: date | None, end: date | None
) -> str | None:
    if start and end:
        period = f"service period {start.isoformat()} to {end.isoformat()}"
    elif start:
        period = f"service period from {start.isoformat()}"
    elif end:
        period = f"service period until {end.isoformat()}"
    else:
        period = None
    parts = [part for part in (vendor, period) if part]
    return " - ".join(parts)[:MAX_TEXT_LENGTH] if parts else None


def _processing_notes(issues: Sequence[Issue]) -> str | None:
    if not issues:
        return None
    notes = "; ".join(f"{i.code} ({i.field}): {i.message}" for i in issues)
    return notes[:MAX_TEXT_LENGTH]


def to_bill_create_dict(
    extraction: BillExtraction, issues: Sequence[Issue] = ()
) -> dict[str, Any]:
    """Map an extraction to the field names of `BillCreate`, for the form pre-fill.

    Values that fail to parse, or that `BillCreate` would reject for that field
    (`amount` must be > 0, `prev_payments` >= 0, at most 12 digits with 2
    decimals), become None so the reviewer fills them in; the matching issue
    says why. Dates are `date`, amounts are `Decimal`. `description` is built
    here from vendor and service period; `processing_notes` from the issues.

    `property_address` is in the dict although `BillCreate` on this branch does
    not have the field yet (the submit-bill-form branch adds it).
    """
    vendor = _clean(extraction.vendor_name)
    return {
        "vendor_name_raw": vendor,
        "account_number_raw": _clean(extraction.account_number),
        "invoice_number": _clean(extraction.invoice_number),
        "invoice_date": parse_date(extraction.invoice_date.value),
        "due_date": parse_date(extraction.due_date.value),
        "amount": _money(extraction.amount_due.value, minimum_exclusive=True),
        "prev_payments": _money(
            extraction.payments_received.value, minimum_exclusive=False
        ),
        "property_address": _clean(extraction.service_address),
        "description": _description(
            vendor,
            parse_date(extraction.service_period_start.value),
            parse_date(extraction.service_period_end.value),
        ),
        "processing_notes": _processing_notes(issues),
    }

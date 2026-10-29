"""The DC-52 checks: plain code, one pure function per row of the spec table.

Every check takes the parsed `BillExtraction` and returns a list of `Issue`.
`run_checks` runs them all. Nothing here calls a model or the database.

How `extract.py` should call this module:

    if not has_text_layer(text_layer):
        extraction = cap_confidence(extraction)   # images: confidence <= medium
    issues = run_checks(extraction, text_layer=text_layer, today=date.today())
    status = decide_status(extraction, issues, failed_reason=None)

The cap is a separate step on purpose: `run_checks` never changes the extraction.
"""

import re
import unicodedata
from calendar import monthrange
from datetime import date
from decimal import Decimal

from backend.extraction.schema import (
    AMOUNT_FIELDS,
    DATE_FIELDS,
    FIELD_NAMES,
    REQUIRED_FIELDS,
    BillExtraction,
    Confidence,
    DocumentType,
    Extracted,
    Issue,
    IssueCode,
    LineItem,
    fits_money,
    parse_amount,
    parse_date,
)

MAX_PAST_YEARS = 1
MAX_FUTURE_MONTHS = 6

_WHITESPACE_RE = re.compile(r"\s+")


def _present(field: Extracted) -> bool:
    return field.value is not None and field.value.strip() != ""


def _issue(code: IssueCode, field: str, message: str) -> Issue:
    return Issue(code=code, field=field, message=message)


def _shift_months(day: date, months: int) -> date:
    """`day` moved by whole months; the day is clamped to the target month."""
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    return day.replace(
        year=year, month=month, day=min(day.day, monthrange(year, month)[1])
    )


def _valid_amount(field: Extracted) -> Decimal | None:
    """The parsed amount, or None when missing or already a BAD_AMOUNT."""
    amount = parse_amount(field.value)
    if amount is None or not fits_money(amount):
        return None
    return amount


def _amount_fields(extraction: BillExtraction) -> list[tuple[str, Extracted]]:
    fields = [(name, getattr(extraction, name)) for name in AMOUNT_FIELDS]
    fields += [
        (f"line_items[{i}].amount", item.amount)
        for i, item in enumerate(extraction.line_items)
    ]
    return fields


def normalize_for_match(text: str) -> str:
    """NFKC (folds ligatures such as the fi and fl characters), casefold, no whitespace.

    Whitespace is removed rather than collapsed because PDF text layers split and
    join words inconsistently ("Account\\nNumber" vs "AccountNumber").
    """
    folded = unicodedata.normalize("NFKC", text).casefold()
    return _WHITESPACE_RE.sub("", unicodedata.normalize("NFKC", folded))


def has_text_layer(text_layer: str | None) -> bool:
    return text_layer is not None and text_layer.strip() != ""


def cap_confidence(
    extraction: BillExtraction, ceiling: Confidence = Confidence.medium
) -> BillExtraction:
    """A copy with every confidence above `ceiling` lowered to it.

    Spec: images have no text layer, so evidence cannot be verified and confidence
    is capped at `medium`. Call this when `has_text_layer(...)` is False.
    """

    def capped(field: Extracted) -> Extracted:
        if field.confidence.rank <= ceiling.rank:
            return field
        return field.model_copy(update={"confidence": ceiling})

    update: dict[str, object] = {
        name: capped(getattr(extraction, name)) for name in FIELD_NAMES
    }
    update["line_items"] = [
        LineItem(description=capped(item.description), amount=capped(item.amount))
        for item in extraction.line_items
    ]
    return extraction.model_copy(update=update)


def check_missing_required(extraction: BillExtraction) -> list[Issue]:
    return [
        _issue(IssueCode.MISSING_REQUIRED, name, f"{name} is missing")
        for name in REQUIRED_FIELDS
        if not _present(getattr(extraction, name))
    ]


def check_bad_dates(extraction: BillExtraction) -> list[Issue]:
    return [
        _issue(IssueCode.BAD_DATE, name, f"{name} is not a YYYY-MM-DD date")
        for name in DATE_FIELDS
        if _present(getattr(extraction, name))
        and parse_date(getattr(extraction, name).value) is None
    ]


def check_due_before_invoice(extraction: BillExtraction) -> list[Issue]:
    invoice = parse_date(extraction.invoice_date.value)
    due = parse_date(extraction.due_date.value)
    if invoice is not None and due is not None and due < invoice:
        return [
            _issue(
                IssueCode.DUE_BEFORE_INVOICE,
                "due_date",
                "due_date is before invoice_date",
            )
        ]
    return []


def check_dates_in_range(extraction: BillExtraction, today: date) -> list[Issue]:
    """Out of range: more than 1 year before `today` or more than 6 months after.

    Exactly one year back, or exactly six months ahead, is still in range.
    """
    earliest = _shift_months(today, -12 * MAX_PAST_YEARS)
    latest = _shift_months(today, MAX_FUTURE_MONTHS)
    issues = []
    for name in DATE_FIELDS:
        parsed = parse_date(getattr(extraction, name).value)
        if parsed is not None and not earliest <= parsed <= latest:
            issues.append(
                _issue(
                    IssueCode.DATE_OUT_OF_RANGE,
                    name,
                    f"{name} is more than 1 year in the past or 6 months in the future",
                )
            )
    return issues


def check_amounts(extraction: BillExtraction) -> list[Issue]:
    """Amounts parse and fit 12 digits with 2 decimals; amount_due > 0.

    `payments_received` is positive in the schema, so a negative one is also bad.
    `previous_balance`, `current_charges` and line items may be negative (credits).
    """
    issues = []
    for name, field in _amount_fields(extraction):
        if not _present(field):
            continue
        amount = parse_amount(field.value)
        if amount is None:
            issues.append(
                _issue(IssueCode.BAD_AMOUNT, name, f"{name} is not a valid amount")
            )
        elif not fits_money(amount):
            issues.append(
                _issue(
                    IssueCode.BAD_AMOUNT,
                    name,
                    f"{name} has more than 12 digits or 2 decimals",
                )
            )
        elif name == "amount_due" and amount <= 0:
            issues.append(
                _issue(IssueCode.BAD_AMOUNT, name, "amount_due must be greater than 0")
            )
        elif name == "payments_received" and amount < 0:
            issues.append(
                _issue(
                    IssueCode.BAD_AMOUNT,
                    name,
                    "payments_received must not be negative",
                )
            )
    return issues


def check_line_items_total(extraction: BillExtraction) -> list[Issue]:
    """Line items add up to `current_charges`, when both exist."""
    charges = _valid_amount(extraction.current_charges)
    if charges is None or not extraction.line_items:
        return []
    amounts = [_valid_amount(item.amount) for item in extraction.line_items]
    if any(amount is None for amount in amounts):
        return []
    if sum(amounts, Decimal(0)) != charges:
        return [
            _issue(
                IssueCode.LINE_ITEMS_MISMATCH,
                "current_charges",
                "line items do not add up to current_charges",
            )
        ]
    return []


def check_balance(extraction: BillExtraction) -> list[Issue]:
    """previous_balance - payments_received + current_charges == amount_due."""
    previous = _valid_amount(extraction.previous_balance)
    payments = _valid_amount(extraction.payments_received)
    charges = _valid_amount(extraction.current_charges)
    due = _valid_amount(extraction.amount_due)
    if previous is None or payments is None or charges is None or due is None:
        return []
    if previous - payments + charges != due:
        return [
            _issue(
                IssueCode.BALANCE_MISMATCH,
                "amount_due",
                "previous_balance - payments_received + current_charges "
                "does not equal amount_due",
            )
        ]
    return []


def check_evidence(extraction: BillExtraction, text_layer: str | None) -> list[Issue]:
    """Every non-null value's evidence appears in the PDF text layer.

    Skipped (no issues) when there is no text layer. A non-null value with empty
    evidence is not found: an empty string would otherwise match everything.
    """
    if not has_text_layer(text_layer):
        return []
    assert text_layer is not None
    haystack = normalize_for_match(text_layer)
    issues = []
    for name, field in extraction.iter_fields():
        if not _present(field):
            continue
        needle = normalize_for_match(field.evidence)
        if not needle or needle not in haystack:
            issues.append(
                _issue(
                    IssueCode.EVIDENCE_NOT_FOUND,
                    name,
                    f"evidence for {name} was not found in the document text",
                )
            )
    return issues


def check_low_confidence(extraction: BillExtraction) -> list[Issue]:
    """A required field that has a value but was marked low by the model.

    A missing required field is MISSING_REQUIRED, not reported twice.
    """
    return [
        _issue(IssueCode.LOW_CONFIDENCE, name, f"{name} was read with low confidence")
        for name in REQUIRED_FIELDS
        if _present(getattr(extraction, name))
        and getattr(extraction, name).confidence == Confidence.low
    ]


def run_checks(
    extraction: BillExtraction, *, text_layer: str | None, today: date
) -> list[Issue]:
    """All checks, in spec order. A document that is not an invoice has no checks."""
    if extraction.document_type == DocumentType.not_an_invoice:
        return []
    return [
        *check_missing_required(extraction),
        *check_bad_dates(extraction),
        *check_due_before_invoice(extraction),
        *check_dates_in_range(extraction, today),
        *check_amounts(extraction),
        *check_line_items_total(extraction),
        *check_balance(extraction),
        *check_evidence(extraction, text_layer),
        *check_low_confidence(extraction),
    ]

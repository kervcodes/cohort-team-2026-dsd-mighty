"""Every answer key is consistent with the checks: no model is called.

Each key's values are turned into an extraction whose evidence is copied from
the bill's own PDF text layer, the way a model copies it, and run through
`run_checks` on the eval's date. The issues and status must be exactly the
key's `expected_issues` and `expected_status`. Two evidence forms are tried:
the value as printed ("$1,942.34", "November 13, 2026"), and the whole printed
line around it ("Total amount due by November 13, 2026 $1,942.34").

Images have no text layer; their evidence is the value itself.
"""

import io
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from pypdf import PdfReader

from backend.evals import run
from backend.extraction.checks import (
    cap_confidence,
    has_text_layer,
    normalize_for_match,
    run_checks,
)
from backend.extraction.schema import (
    AMOUNT_FIELDS,
    DATE_FIELDS,
    FIELD_NAMES,
    BillExtraction,
    Confidence,
    Extracted,
    LineItem,
)
from backend.extraction.status import decide_status

BILLS = run.find_bills("all")


def printed_amounts(value: str) -> list[str]:
    amount = abs(Decimal(value))
    grouped, plain = f"{amount:,.2f}", f"{amount:.2f}"
    return [
        f"${grouped}",
        f"-${grouped}",
        f"-{grouped}",
        f"({grouped})",
        grouped,
        plain,
    ]


def printed_dates(value: str) -> list[str]:
    day = date.fromisoformat(value)
    return [
        f"{day:%m/%d/%Y}",
        f"{day:%B} {day.day}, {day.year}",
        f"{day:%b} {day.day}, {day.year}",
        value,
        f"{day.month}/{day.day}/{day.year}",
        f"{day:%m/%d/%y}",
    ]


def printed_form(text: str, kind: str, value: str) -> str:
    """How the bill prints `value`; fails the test when it does not."""
    forms = {
        "date": printed_dates,
        "amount": printed_amounts,
        "string": lambda v: [v],
    }[kind](value)
    haystack = normalize_for_match(text)
    for form in forms:
        if normalize_for_match(form) in haystack:
            return form
    raise AssertionError(f"{value!r} is not printed on the bill")


def printed_line(text: str, form: str) -> str:
    """The text-layer line that holds `form`; `form` itself when it is split
    over lines (an address printed on two lines)."""
    needle = normalize_for_match(form)
    return next(
        (line for line in text.splitlines() if needle in normalize_for_match(line)),
        form,
    )


def kind_of(name: str) -> str:
    if name in DATE_FIELDS:
        return "date"
    if name in AMOUNT_FIELDS or name == "line item amount":
        return "amount"
    return "string"


def extraction_from_key(
    key: dict[str, Any], text: str | None, whole_line: bool
) -> BillExtraction:
    def field(name: str, value: str | None) -> Extracted:
        evidence = value or ""
        if value is not None and text is not None:
            evidence = printed_form(text, kind_of(name), value)
            if whole_line:
                evidence = printed_line(text, evidence)
        return Extracted(value=value, evidence=evidence, confidence=Confidence.high)

    return BillExtraction(
        document_type=key["document_type"],
        **{name: field(name, key[name]) for name in FIELD_NAMES},
        line_items=[
            LineItem(
                description=field("line item description", item["description"]),
                amount=field("line item amount", item["amount"]),
            )
            for item in key["line_items"]
        ],
    )


def text_layer(bill: run.Bill) -> str | None:
    if bill.media_type != "application/pdf":
        return None
    reader = PdfReader(io.BytesIO(bill.path.read_bytes()))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def test_there_are_24_answer_keys():
    assert len(BILLS) == 24


@pytest.mark.parametrize("whole_line", [False, True], ids=["printed", "line"])
@pytest.mark.parametrize("bill", BILLS, ids=[bill.name for bill in BILLS])
def test_answer_key_gives_its_expected_issues_and_status(
    bill: run.Bill, whole_line: bool
):
    key = run.load_expected(bill)
    text = text_layer(bill)
    extraction = extraction_from_key(key, text, whole_line)
    if not has_text_layer(text):
        extraction = cap_confidence(extraction)
    issues = run_checks(extraction, text_layer=text, today=run.EVAL_TODAY)
    assert sorted({issue.code.value for issue in issues}) == key["expected_issues"]
    status = decide_status(extraction, issues, failed_reason=None)
    assert status.value == key["expected_status"]

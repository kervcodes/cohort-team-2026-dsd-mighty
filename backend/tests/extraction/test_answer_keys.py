"""Every answer key is consistent with the checks: no model is called.

Each key's values are turned into an extraction whose evidence is copied from
the bill's own PDF text layer, the way a model copies it, and run through
`run_checks` on the eval's date. The issues and status must be exactly the
key's `expected_issues` and `expected_status`. Two evidence forms are tried:
the value as printed ("$1,942.34", "November 13, 2026", "UNPAID"), and the
whole printed line around it ("Total amount due by November 13, 2026
$1,942.34", "Posting status: UNPAID").

Images have no text layer; their evidence is the value itself.
"""

import io
import re
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


def printed_status(text: str, value: str) -> str:
    """The status word as the bill prints it ("UNPAID"), matched as a whole
    word so that "paid" is not found inside "UNPAID"."""
    found = re.search(rf"\b{re.escape(value)}\b", text, re.IGNORECASE)
    if found is None:
        raise AssertionError(f"status {value!r} is not printed on the bill")
    return found.group()


def printed_form(text: str, kind: str, value: str) -> str:
    """How the bill prints `value`; fails the test when it does not."""
    if kind == "status":
        return printed_status(text, value)
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


def printed_line(text: str, kind: str, form: str) -> str:
    """The text-layer line that holds `form`; `form` itself when it is split
    over lines (an address printed on two lines)."""
    if kind == "status":
        word = re.compile(rf"\b{re.escape(form)}\b")
        return next(line for line in text.splitlines() if word.search(line))
    needle = normalize_for_match(form)
    return next(
        (line for line in text.splitlines() if needle in normalize_for_match(line)),
        form,
    )


def kind_of(name: str) -> str:
    if name == "account_status":
        return "status"
    if name in DATE_FIELDS:
        return "date"
    if name in AMOUNT_FIELDS or name == "line item amount":
        return "amount"
    return "string"


def extraction_from_key(
    key: dict[str, Any], text: str | None, whole_line: bool
) -> BillExtraction:
    def field(name: str, value: str | None) -> dict[str, Any]:
        evidence = value or ""
        if value is not None and text is not None:
            evidence = printed_form(text, kind_of(name), value)
            if whole_line:
                evidence = printed_line(text, kind_of(name), evidence)
        return {"value": value, "evidence": evidence, "confidence": "high"}

    return BillExtraction.model_validate(
        {
            "document_type": key["document_type"],
            **{name: field(name, key[name]) for name in FIELD_NAMES},
            "line_items": [
                {
                    "description": field("line item description", item["description"]),
                    "amount": field("line item amount", item["amount"]),
                }
                for item in key["line_items"]
            ],
        }
    )


def text_layer(bill: run.Bill) -> str | None:
    if bill.media_type != "application/pdf":
        return None
    reader = PdfReader(io.BytesIO(bill.path.read_bytes()))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


# Every DSD sample bill is for this property (scripts/make-demo-bills.mjs reuses it).
DSD_PROPERTY = "125 Industrial Way, Springfield, IL 62701"
DSD_SAMPLE_BILLS = [bill for bill in BILLS if not bill.name.startswith("gen-")]


def test_there_are_26_answer_keys():
    assert len(BILLS) == 26
    assert len(DSD_SAMPLE_BILLS) == 10


@pytest.mark.parametrize(
    "bill", DSD_SAMPLE_BILLS, ids=[bill.name for bill in DSD_SAMPLE_BILLS]
)
def test_dsd_sample_key_has_everything_the_new_invoice_form_needs(bill: run.Bill):
    """Each DSD sample bill prints a description, a pay-online URL, its status
    and the property (labeled, or with the customer name: the fallback)."""
    key = run.load_expected(bill)
    assert key["service_address"] == DSD_PROPERTY
    assert key["description"]
    assert re.fullmatch(
        r"https://[a-z-]+-utility-demo\.vercel\.app", key["payment_website"]
    )
    assert key["account_status"] == "unpaid"


def test_generated_bills_cover_every_account_status():
    statuses = {
        run.load_expected(bill)["account_status"]
        for bill in BILLS
        if bill.name.startswith("gen-")
    }
    assert statuses == {"unpaid", "outstanding", "paid", None}  # None: the letter


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


def test_paid_and_outstanding_generated_bills_have_consistent_amounts():
    """The PAID copy owes nothing (so BAD_AMOUNT: BillCreate needs an amount
    above 0); the OUTSTANDING statement carries an unpaid previous balance."""
    by_name = {bill.name: bill for bill in BILLS}
    paid = run.load_expected(by_name["gen-plumbing-paid"])
    assert paid["account_status"] == "paid"
    assert Decimal(paid["amount_due"]) == 0
    assert paid["payments_received"] == paid["current_charges"]
    assert paid["expected_issues"] == ["BAD_AMOUNT"]

    owed = run.load_expected(by_name["gen-gas-outstanding"])
    assert owed["account_status"] == "outstanding"
    assert Decimal(owed["payments_received"]) == 0
    assert Decimal(owed["previous_balance"]) > 0
    assert Decimal(owed["amount_due"]) == Decimal(owed["previous_balance"]) + Decimal(
        owed["current_charges"]
    )
    assert owed["expected_status"] == "ready_for_review"

from datetime import date

import pytest
from bill_factory import (
    TEXT_LAYER,
    TODAY,
    clean_extraction,
    ex,
    not_an_invoice,
    null,
)

from backend.extraction.checks import (
    cap_confidence,
    check_amounts,
    check_bad_dates,
    check_balance,
    check_dates_in_range,
    check_due_before_invoice,
    check_evidence,
    check_line_items_total,
    check_low_confidence,
    check_missing_required,
    has_text_layer,
    normalize_for_match,
    run_checks,
)
from backend.extraction.schema import (
    BillExtraction,
    Confidence,
    IssueCode,
    LineItem,
)


def codes(issues):
    return [(issue.code, issue.field) for issue in issues]


def items(*amounts: str | None) -> list[LineItem]:
    return [
        LineItem(description=ex(f"Item {i}"), amount=ex(amount))
        for i, amount in enumerate(amounts)
    ]


# --- run_checks ---------------------------------------------------------------


def test_clean_extraction_has_no_issues():
    assert run_checks(clean_extraction(), text_layer=TEXT_LAYER, today=TODAY) == []


def test_clean_extraction_without_text_layer_has_no_issues():
    assert run_checks(clean_extraction(), text_layer=None, today=TODAY) == []


def test_not_an_invoice_runs_no_checks():
    # All required fields are null, which would be MISSING_REQUIRED for an invoice.
    assert run_checks(not_an_invoice(), text_layer=TEXT_LAYER, today=TODAY) == []


def test_run_checks_reports_every_failing_check():
    extraction = clean_extraction(
        vendor_name=null(),
        due_date=ex("2020-01-01"),
        amount_due=ex("5000.00", "Total amount due 5680.00"),
    )
    found = {
        issue.code
        for issue in run_checks(extraction, text_layer=TEXT_LAYER, today=TODAY)
    }
    assert found == {
        IssueCode.MISSING_REQUIRED,
        IssueCode.DUE_BEFORE_INVOICE,
        IssueCode.DATE_OUT_OF_RANGE,
        IssueCode.BALANCE_MISMATCH,
        IssueCode.EVIDENCE_NOT_FOUND,  # the made-up due date is not in the text
    }


# --- MISSING_REQUIRED ---------------------------------------------------------


@pytest.mark.parametrize(
    "field",
    ["vendor_name", "account_number", "invoice_number", "due_date", "amount_due"],
)
def test_missing_required_field_is_reported(field: str):
    issues = check_missing_required(clean_extraction(**{field: null()}))
    assert codes(issues) == [(IssueCode.MISSING_REQUIRED, field)]


def test_blank_required_value_counts_as_missing():
    issues = check_missing_required(clean_extraction(vendor_name=ex("   ", "x")))
    assert codes(issues) == [(IssueCode.MISSING_REQUIRED, "vendor_name")]


@pytest.mark.parametrize(
    "field",
    [
        "invoice_date",
        "previous_balance",
        "payments_received",
        "current_charges",
        "service_address",
        "service_period_start",
        "service_period_end",
    ],
)
def test_optional_field_may_be_null(field: str):
    assert check_missing_required(clean_extraction(**{field: null()})) == []


# --- BAD_DATE -----------------------------------------------------------------


@pytest.mark.parametrize(
    "text", ["2026-10-20", "2024-02-29", "2026-01-01", " 2026-10-20 "]
)
def test_valid_dates_pass(text: str):
    assert check_bad_dates(clean_extraction(invoice_date=ex(text))) == []


@pytest.mark.parametrize(
    "text",
    [
        "10/20/2026",
        "20261020",
        "2026-13-01",
        "2026-02-30",
        "2025-02-29",
        "2026-1-5",
        "Oct 20, 2026",
        "tomorrow",
        "２０２６-10-20",
    ],
)
def test_bad_dates_are_reported(text: str):
    issues = check_bad_dates(clean_extraction(invoice_date=ex(text)))
    assert codes(issues) == [(IssueCode.BAD_DATE, "invoice_date")]


@pytest.mark.parametrize(
    "field",
    ["invoice_date", "due_date", "service_period_start", "service_period_end"],
)
def test_every_date_field_is_checked(field: str):
    issues = check_bad_dates(clean_extraction(**{field: ex("soon")}))
    assert codes(issues) == [(IssueCode.BAD_DATE, field)]


def test_null_date_is_not_a_bad_date():
    assert check_bad_dates(clean_extraction(invoice_date=null())) == []


# --- DUE_BEFORE_INVOICE -------------------------------------------------------


def test_due_after_invoice_passes():
    assert check_due_before_invoice(clean_extraction()) == []


def test_due_same_day_as_invoice_passes():
    extraction = clean_extraction(due_date=ex("2026-10-20"))
    assert check_due_before_invoice(extraction) == []


def test_due_before_invoice_is_reported():
    extraction = clean_extraction(due_date=ex("2026-10-19"))
    assert codes(check_due_before_invoice(extraction)) == [
        (IssueCode.DUE_BEFORE_INVOICE, "due_date")
    ]


def test_due_before_invoice_skipped_when_a_date_is_unparseable_or_missing():
    assert check_due_before_invoice(clean_extraction(due_date=ex("soon"))) == []
    assert check_due_before_invoice(clean_extraction(invoice_date=null())) == []


# --- DATE_OUT_OF_RANGE (today = 2026-10-29) -----------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "2025-10-29",  # exactly 1 year ago
        "2026-10-29",  # today
        "2027-04-29",  # exactly 6 months ahead
    ],
)
def test_dates_on_the_boundary_are_in_range(text: str):
    assert check_dates_in_range(clean_extraction(due_date=ex(text)), TODAY) == []


@pytest.mark.parametrize(
    "text",
    [
        "2025-10-28",  # 1 year and 1 day ago
        "2027-04-30",  # 6 months and 1 day ahead
        "1999-01-01",
        "2030-01-01",
    ],
)
def test_dates_outside_the_boundary_are_reported(text: str):
    issues = check_dates_in_range(clean_extraction(due_date=ex(text)), TODAY)
    assert codes(issues) == [(IssueCode.DATE_OUT_OF_RANGE, "due_date")]


def test_range_boundaries_clamp_to_month_end():
    # 6 months after Aug 31 is Feb 28 (2027), not an invalid Feb 31.
    aug_31 = date(2026, 8, 31)
    on_edge = clean_extraction(due_date=ex("2027-02-28"))
    past_edge = clean_extraction(due_date=ex("2027-03-01"))
    assert check_dates_in_range(on_edge, aug_31) == []
    assert codes(check_dates_in_range(past_edge, aug_31)) == [
        (IssueCode.DATE_OUT_OF_RANGE, "due_date")
    ]


def test_range_boundary_on_leap_day():
    leap_day = date(2028, 2, 29)

    def due_date_codes(text: str):
        extraction = clean_extraction(due_date=ex(text))
        issues = check_dates_in_range(extraction, leap_day)
        return [c for c in codes(issues) if c[1] == "due_date"]

    assert due_date_codes("2027-02-28") == []
    assert due_date_codes("2027-02-27") == [(IssueCode.DATE_OUT_OF_RANGE, "due_date")]


def test_service_period_dates_are_range_checked_too():
    extraction = clean_extraction(service_period_start=ex("2020-01-01"))
    assert codes(check_dates_in_range(extraction, TODAY)) == [
        (IssueCode.DATE_OUT_OF_RANGE, "service_period_start")
    ]


def test_unparseable_date_is_not_range_checked():
    assert check_dates_in_range(clean_extraction(due_date=ex("soon")), TODAY) == []


# --- BAD_AMOUNT ---------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "1180.50",
        "1,180.50",
        "$1,180.50",
        "$ 1180.50".replace(" ", ""),
        "0.01",
        "5680",
        "9999999999.99",
        "1180.500",
        "-20.00",
    ],
)
def test_valid_amounts_pass(text: str):
    # -20.00 is a valid credit for previous_balance.
    extraction = clean_extraction(
        previous_balance=ex(text), amount_due=ex(text.lstrip("-") or "1")
    )
    assert check_amounts(extraction) == []


@pytest.mark.parametrize(
    "text",
    [
        "abc",
        "12.5.0",
        "1e5",
        "NaN",
        "Infinity",
        "1,18",
        "1,1800.00",
        "$",
        "5 680.00",
        "1180,50",
        "(20.00)",
        "١٢٣",
    ],
)
def test_non_numeric_amounts_are_bad(text: str):
    extraction = clean_extraction(previous_balance=ex(text, "x"))
    assert codes(check_amounts(extraction)) == [
        (IssueCode.BAD_AMOUNT, "previous_balance")
    ]


@pytest.mark.parametrize("text", ["12.345", "10000000000.00", "1234567890123"])
def test_amounts_with_too_many_digits_are_bad(text: str):
    extraction = clean_extraction(amount_due=ex(text))
    assert codes(check_amounts(extraction)) == [(IssueCode.BAD_AMOUNT, "amount_due")]


@pytest.mark.parametrize("text", ["0", "0.00", "-5.00", "-0.01"])
def test_amount_due_must_be_greater_than_zero(text: str):
    extraction = clean_extraction(amount_due=ex(text))
    assert codes(check_amounts(extraction)) == [(IssueCode.BAD_AMOUNT, "amount_due")]


def test_smallest_positive_amount_due_passes():
    assert check_amounts(clean_extraction(amount_due=ex("0.01"))) == []


def test_negative_payments_received_is_bad():
    extraction = clean_extraction(payments_received=ex("-1520.00"))
    assert codes(check_amounts(extraction)) == [
        (IssueCode.BAD_AMOUNT, "payments_received")
    ]


def test_zero_payments_received_passes():
    assert check_amounts(clean_extraction(payments_received=ex("0.00"))) == []


def test_credits_are_allowed_for_balance_charges_and_line_items():
    extraction = clean_extraction(
        previous_balance=ex("-50.00"),
        current_charges=ex("-10.00"),
        line_items=items("-10.00"),
    )
    assert check_amounts(extraction) == []


def test_bad_line_item_amount_is_reported_with_its_index():
    extraction = clean_extraction(line_items=items("5000.00", "six hundred"))
    assert codes(check_amounts(extraction)) == [
        (IssueCode.BAD_AMOUNT, "line_items[1].amount")
    ]


def test_blank_optional_amount_is_treated_as_absent():
    extraction = clean_extraction(previous_balance=ex("  ", "x"))
    assert check_amounts(extraction) == []
    assert check_balance(extraction) == []


def test_null_amounts_are_not_bad_amounts():
    extraction = clean_extraction(
        previous_balance=null(), payments_received=null(), current_charges=null()
    )
    assert check_amounts(extraction) == []


# --- LINE_ITEMS_MISMATCH ------------------------------------------------------


def test_line_items_that_add_up_pass():
    assert check_line_items_total(clean_extraction()) == []


def test_line_items_that_do_not_add_up_are_reported():
    extraction = clean_extraction(line_items=items("5000.00", "679.99"))
    assert codes(check_line_items_total(extraction)) == [
        (IssueCode.LINE_ITEMS_MISMATCH, "current_charges")
    ]


def test_line_item_sum_is_exact_decimal_not_float():
    # In floats 0.1 + 0.2 != 0.3; as decimals they are equal.
    extraction = clean_extraction(
        current_charges=ex("0.30"), line_items=items("0.10", "0.20")
    )
    assert check_line_items_total(extraction) == []


def test_line_item_sum_one_cent_off_is_reported():
    extraction = clean_extraction(
        current_charges=ex("0.30"), line_items=items("0.10", "0.21")
    )
    assert codes(check_line_items_total(extraction)) == [
        (IssueCode.LINE_ITEMS_MISMATCH, "current_charges")
    ]


def test_line_items_with_formatting_are_summed():
    extraction = clean_extraction(
        current_charges=ex("1,180.50"), line_items=items("$1,000.00", "180.50")
    )
    assert check_line_items_total(extraction) == []


@pytest.mark.parametrize("current_charges", [null(), ex("n/a")])
def test_line_item_check_skipped_without_usable_current_charges(current_charges):
    extraction = clean_extraction(
        current_charges=current_charges, line_items=items("1.00")
    )
    assert check_line_items_total(extraction) == []


def test_line_item_check_skipped_without_line_items():
    assert check_line_items_total(clean_extraction(line_items=[])) == []


def test_line_item_check_skipped_when_an_item_amount_is_unusable():
    extraction = clean_extraction(line_items=items("5000.00", None))
    assert check_line_items_total(extraction) == []
    extraction = clean_extraction(line_items=items("5000.00", "abc"))
    assert check_line_items_total(extraction) == []


# --- BALANCE_MISMATCH ---------------------------------------------------------


def test_balance_that_adds_up_passes():
    # 1520.00 - 1520.00 + 5680.00 == 5680.00
    assert check_balance(clean_extraction()) == []


def test_balance_with_carried_over_balance_passes():
    extraction = clean_extraction(
        previous_balance=ex("100.10"),
        payments_received=ex("50.00"),
        current_charges=ex("0.20"),
        amount_due=ex("50.30"),
    )
    assert check_balance(extraction) == []


def test_balance_off_by_a_cent_is_reported():
    extraction = clean_extraction(amount_due=ex("5680.01"))
    assert codes(check_balance(extraction)) == [
        (IssueCode.BALANCE_MISMATCH, "amount_due")
    ]


def test_amount_due_equal_to_charges_when_balance_unpaid_is_reported():
    # Unpaid previous balance of 1520 means more than the 5680 current charges is due.
    extraction = clean_extraction(payments_received=ex("0.00"))
    assert codes(check_balance(extraction)) == [
        (IssueCode.BALANCE_MISMATCH, "amount_due")
    ]


def test_payments_sign_matters():
    # A negative payment is wrong in the schema, and does not satisfy the formula.
    extraction = clean_extraction(
        previous_balance=ex("1520.00"),
        payments_received=ex("-1520.00"),
        current_charges=ex("5680.00"),
        amount_due=ex("5680.00"),
    )
    assert codes(check_balance(extraction)) == [
        (IssueCode.BALANCE_MISMATCH, "amount_due")
    ]


@pytest.mark.parametrize(
    "field", ["previous_balance", "payments_received", "current_charges", "amount_due"]
)
def test_balance_check_skipped_when_a_term_is_missing(field: str):
    assert check_balance(clean_extraction(**{field: null()})) == []


def test_balance_check_skipped_when_a_term_is_unparseable():
    assert check_balance(clean_extraction(previous_balance=ex("abc"))) == []


# --- EVIDENCE_NOT_FOUND -------------------------------------------------------


def test_evidence_found_in_text_layer_passes():
    assert check_evidence(clean_extraction(), TEXT_LAYER) == []


def test_evidence_not_in_text_layer_is_reported():
    extraction = clean_extraction(vendor_name=ex("Acme Corp"))
    assert codes(check_evidence(extraction, TEXT_LAYER)) == [
        (IssueCode.EVIDENCE_NOT_FOUND, "vendor_name")
    ]


def test_evidence_for_each_line_item_field_is_checked():
    extraction = clean_extraction(
        line_items=[
            LineItem(
                description=ex("Gas service"),
                amount=ex("5000.00", "Water service 5000.00"),
            )
        ]
    )
    assert codes(check_evidence(extraction, TEXT_LAYER)) == [
        (IssueCode.EVIDENCE_NOT_FOUND, "line_items[0].description")
    ]


@pytest.mark.parametrize(
    "evidence",
    [
        "BRIGHTWATER UTILITIES",
        "brightwater utilities",
        "Brightwater    Utilities",
        "Brightwater\nUtilities",
        "  Brightwater\t\tUtilities  ",
        "Brightwater Utilities",
        "BrightwaterUtilities",
    ],
)
def test_evidence_matches_ignoring_case_and_whitespace(evidence: str):
    extraction = clean_extraction(vendor_name=ex("Brightwater Utilities", evidence))
    assert check_evidence(extraction, TEXT_LAYER) == []


def test_text_layer_whitespace_and_case_are_normalised_too():
    layer = "BRIGHTWATER\n\n   UTILITIES\r\nAccount   88-2110-4471"
    extraction = clean_extraction(
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
    assert check_evidence(extraction, layer) == []


def test_ligatures_in_text_layer_match_plain_evidence():
    layer = "Brightﬁeld Ofﬁce Utilities"  # fi and fl style ligature glyphs
    extraction = clean_extraction(
        vendor_name=ex("Brightfield Office Utilities"),
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
    assert check_evidence(extraction, layer) == []


def test_ligatures_in_evidence_match_plain_text_layer():
    layer = "Workflow ﬂows from the ofﬁce"
    assert normalize_for_match("ﬂows") == normalize_for_match("flows")
    assert normalize_for_match("ﬁ") == "fi"
    extraction = clean_extraction(
        vendor_name=ex("Workflow", "Workﬂow"),
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
    assert check_evidence(extraction, layer) == []


def test_null_value_needs_no_evidence():
    extraction = clean_extraction(service_address=ex(None, "text not in the document"))
    assert check_evidence(extraction, TEXT_LAYER) == []


def test_non_null_value_with_empty_evidence_is_not_found():
    # An empty needle is a substring of everything; it must not pass silently.
    for evidence in ["", "   \n"]:
        extraction = clean_extraction(vendor_name=ex("Brightwater Utilities", evidence))
        assert codes(check_evidence(extraction, TEXT_LAYER)) == [
            (IssueCode.EVIDENCE_NOT_FOUND, "vendor_name")
        ]


@pytest.mark.parametrize("text_layer", [None, "", "  \n\t "])
def test_evidence_check_skipped_without_text_layer(text_layer):
    extraction = clean_extraction(vendor_name=ex("Anything", "not in any document"))
    assert check_evidence(extraction, text_layer) == []
    assert not has_text_layer(text_layer)


def test_has_text_layer():
    assert has_text_layer("Invoice")


# --- cap_confidence -----------------------------------------------------------


def all_confidences(extraction: BillExtraction) -> set[Confidence]:
    return {field.confidence for _, field in extraction.iter_fields()}


def test_cap_lowers_high_to_medium_everywhere_including_line_items():
    capped = cap_confidence(clean_extraction())
    assert all_confidences(capped) == {Confidence.medium}
    assert len(capped.line_items) == 2


def test_cap_keeps_lower_confidence_and_does_not_mutate_input():
    original = clean_extraction(
        vendor_name=ex("Brightwater Utilities", confidence=Confidence.low)
    )
    capped = cap_confidence(original)
    assert capped.vendor_name.confidence == Confidence.low
    assert original.account_number.confidence == Confidence.high
    assert capped.document_type == original.document_type


def test_cap_ceiling_can_be_chosen():
    assert all_confidences(cap_confidence(clean_extraction(), Confidence.low)) == {
        Confidence.low
    }


# --- LOW_CONFIDENCE -----------------------------------------------------------


def test_low_confidence_on_required_field_is_reported():
    extraction = clean_extraction(
        invoice_number=ex("BW-4471-2611", confidence=Confidence.low)
    )
    assert codes(check_low_confidence(extraction)) == [
        (IssueCode.LOW_CONFIDENCE, "invoice_number")
    ]


def test_medium_confidence_on_required_field_passes():
    extraction = clean_extraction(
        invoice_number=ex("BW-4471-2611", confidence=Confidence.medium)
    )
    assert check_low_confidence(extraction) == []


def test_low_confidence_on_optional_field_is_ignored():
    extraction = clean_extraction(
        service_address=ex("2110 Example Ave", confidence=Confidence.low)
    )
    assert check_low_confidence(extraction) == []


def test_low_confidence_on_missing_required_field_is_only_missing_required():
    extraction = clean_extraction(vendor_name=ex(None, confidence=Confidence.low))
    assert check_low_confidence(extraction) == []
    assert codes(check_missing_required(extraction)) == [
        (IssueCode.MISSING_REQUIRED, "vendor_name")
    ]

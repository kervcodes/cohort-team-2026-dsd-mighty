import json
from datetime import date
from decimal import Decimal

import pytest
from bill_factory import clean_extraction, ex, null
from pydantic import ValidationError

from backend.extraction.schema import (
    MAX_LENGTHS,
    BillExtraction,
    ExtractionResult,
    ExtractionStatus,
    Issue,
    IssueCode,
    parse_amount,
    parse_date,
    to_bill_create_dict,
)
from backend.schemas.bill import BillCreate

# --- JSON schema --------------------------------------------------------------


def ref_graph(schema: dict) -> dict[str, set[str]]:
    """definition name -> definitions it refers to."""

    def refs(node) -> set[str]:
        if isinstance(node, dict):
            found = {node["$ref"].rsplit("/", 1)[-1]} if "$ref" in node else set()
            for value in node.values():
                found |= refs(value)
            return found
        if isinstance(node, list):
            return set().union(*(refs(item) for item in node)) if node else set()
        return set()

    return {name: refs(body) for name, body in schema.get("$defs", {}).items()}


def has_cycle(graph: dict[str, set[str]]) -> bool:
    done: set[str] = set()

    def visit(name: str, path: tuple[str, ...]) -> bool:
        if name in path:
            return True
        if name in done:
            return False
        if any(visit(dep, (*path, name)) for dep in graph.get(name, ())):
            return True
        done.add(name)
        return False

    return any(visit(name, ()) for name in graph)


def test_json_schema_is_generated_without_ref_cycles():
    schema = BillExtraction.model_json_schema()
    serialized = json.dumps(schema, separators=(",", ":"))
    print(f"\nBillExtraction JSON schema: {len(serialized)} bytes")
    assert not has_cycle(ref_graph(schema))
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(BillExtraction.model_fields)


def test_cycle_detector_detects_a_cycle():
    assert has_cycle({"A": {"B"}, "B": {"A"}})
    assert not has_cycle({"A": {"B"}, "B": set()})


def test_json_schema_avoids_regex_and_numeric_constructs():
    serialized = json.dumps(BillExtraction.model_json_schema())
    for banned in ("pattern", "format", "minimum", "maximum", "number", "integer"):
        assert f'"{banned}"' not in serialized


def test_extraction_round_trips_through_json():
    original = clean_extraction()
    restored = BillExtraction.model_validate_json(original.model_dump_json())
    assert restored == original


def test_extraction_with_unknown_field_is_rejected():
    data = clean_extraction().model_dump()
    data["website_name"] = ex("x").model_dump()
    with pytest.raises(ValidationError):
        BillExtraction.model_validate(data)


def test_extraction_missing_a_field_is_rejected():
    data = clean_extraction().model_dump()
    del data["amount_due"]
    with pytest.raises(ValidationError):
        BillExtraction.model_validate(data)


def test_unknown_confidence_is_rejected():
    data = clean_extraction().model_dump()
    data["vendor_name"]["confidence"] = "certain"
    with pytest.raises(ValidationError):
        BillExtraction.model_validate(data)


def test_issue_codes_are_exactly_the_spec_codes():
    assert {code.value for code in IssueCode} == {
        "MISSING_REQUIRED",
        "BAD_DATE",
        "DUE_BEFORE_INVOICE",
        "DATE_OUT_OF_RANGE",
        "BAD_AMOUNT",
        "LINE_ITEMS_MISMATCH",
        "BALANCE_MISMATCH",
        "EVIDENCE_NOT_FOUND",
        "EVIDENCE_MISMATCH",
        "LOW_CONFIDENCE",
        "MODELS_DISAGREE",
    }


def test_result_defaults_are_empty_metadata():
    result = ExtractionResult(status=ExtractionStatus.failed, failed_reason="too big")
    assert result.extraction is None
    assert result.issues == []
    assert result.model is None and result.cost_usd is None
    assert json.loads(result.model_dump_json())["status"] == "failed"


# --- parsing ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1180.50", Decimal("1180.50")),
        ("1,180.50", Decimal("1180.50")),
        ("$1,180.50", Decimal("1180.50")),
        ("-$20.00", Decimal("-20.00")),
        (" 5680 ", Decimal("5680")),
        ("0.1", Decimal("0.1")),
    ],
)
def test_parse_amount(text: str, expected: Decimal):
    assert parse_amount(text) == expected


@pytest.mark.parametrize("text", [None, "", "abc", "1e3", "NaN", "1,18", "1.2.3"])
def test_parse_amount_rejects(text):
    assert parse_amount(text) is None


def test_parse_date():
    assert parse_date("2026-10-20") == date(2026, 10, 20)
    assert parse_date("20261020") is None
    assert parse_date("2026-02-30") is None
    assert parse_date(None) is None


# --- mapping to BillCreate ----------------------------------------------------


def validate_with_bill_create(mapped: dict) -> BillCreate:
    """BillCreate on this branch has no property_address yet (PR #10 adds it)."""
    allowed = set(BillCreate.model_fields)
    return BillCreate.model_validate({k: v for k, v in mapped.items() if k in allowed})


def test_clean_extraction_maps_to_a_valid_bill_create():
    mapped = to_bill_create_dict(clean_extraction())
    bill = validate_with_bill_create(mapped)
    assert bill.vendor_name_raw == "Brightwater Utilities"
    assert bill.account_number_raw == "88-2110-4471"
    assert bill.invoice_number == "BW-4471-2611"
    assert bill.invoice_date == date(2026, 10, 20)
    assert bill.due_date == date(2026, 11, 10)
    assert bill.amount == Decimal("5680.00")
    assert bill.prev_payments == Decimal("1520.00")
    assert bill.processing_notes is None


def test_mapping_follows_the_spec_column():
    # Distinct values, so a swapped mapping fails.
    extraction = clean_extraction(
        amount_due=ex("5680.00"),
        current_charges=ex("4160.00"),
        previous_balance=ex("1520.00"),
        payments_received=ex("1000.00"),
    )
    mapped = to_bill_create_dict(extraction)
    assert mapped["amount"] == Decimal("5680.00")  # amount_due, not current_charges
    assert mapped["prev_payments"] == Decimal("1000.00")  # not previous_balance
    assert mapped["property_address"] == "2110 Example Ave, Dallas, TX 75201"
    assert set(mapped) == {
        "vendor_name_raw",
        "account_number_raw",
        "invoice_number",
        "invoice_date",
        "due_date",
        "amount",
        "prev_payments",
        "property_address",
        "description",
        "processing_notes",
    }


def test_description_is_built_from_vendor_and_service_period():
    description = to_bill_create_dict(clean_extraction())["description"]
    assert description == (
        "Brightwater Utilities - service period 2026-09-13 to 2026-10-12"
    )


def test_description_with_partial_information():
    only_vendor = clean_extraction(
        service_period_start=null(), service_period_end=null()
    )
    assert to_bill_create_dict(only_vendor)["description"] == "Brightwater Utilities"
    only_period = clean_extraction(vendor_name=null())
    assert to_bill_create_dict(only_period)["description"] == (
        "service period 2026-09-13 to 2026-10-12"
    )
    nothing = clean_extraction(
        vendor_name=null(), service_period_start=null(), service_period_end=null()
    )
    assert to_bill_create_dict(nothing)["description"] is None


def test_unparseable_dates_become_none_and_valid_description_parts_survive():
    extraction = clean_extraction(
        invoice_date=ex("Oct 20"), service_period_end=ex("soon")
    )
    mapped = to_bill_create_dict(extraction)
    assert mapped["invoice_date"] is None
    assert (
        mapped["description"]
        == "Brightwater Utilities - service period from 2026-09-13"
    )


@pytest.mark.parametrize("text", ["abc", "1,18", "12.345", "0", "-5.00"])
def test_amount_that_billcreate_would_reject_becomes_none(text: str):
    assert to_bill_create_dict(clean_extraction(amount_due=ex(text)))["amount"] is None


def test_negative_payments_become_none_and_zero_is_kept():
    negative = clean_extraction(payments_received=ex("-1.00"))
    assert to_bill_create_dict(negative)["prev_payments"] is None
    zero = clean_extraction(payments_received=ex("0"))
    assert to_bill_create_dict(zero)["prev_payments"] == Decimal("0.00")


def test_formatted_amount_is_normalised_to_cents():
    mapped = to_bill_create_dict(clean_extraction(amount_due=ex("$1,180.5")))
    assert mapped["amount"] == Decimal("1180.50")


def test_null_and_blank_fields_become_none():
    extraction = clean_extraction(
        vendor_name=null(), service_address=ex("   ", "x"), payments_received=null()
    )
    mapped = to_bill_create_dict(extraction)
    assert mapped["vendor_name_raw"] is None
    assert mapped["property_address"] is None
    assert mapped["prev_payments"] is None


def test_max_lengths_are_read_from_bill_create():
    assert MAX_LENGTHS == {
        "vendor_name_raw": 200,
        "account_number_raw": 100,
        "invoice_number": 100,
        "description": 2000,
        "processing_notes": 2000,
    }


@pytest.mark.parametrize(
    ("field", "key"),
    [
        ("vendor_name", "vendor_name_raw"),
        ("account_number", "account_number_raw"),
        ("invoice_number", "invoice_number"),
    ],
)
def test_text_longer_than_bill_create_allows_becomes_none(field: str, key: str):
    limit = MAX_LENGTHS[key]
    at_limit = to_bill_create_dict(clean_extraction(**{field: ex("A" * limit)}))
    assert at_limit[key] == "A" * limit
    validate_with_bill_create(at_limit)
    too_long = to_bill_create_dict(clean_extraction(**{field: ex("A" * (limit + 1))}))
    assert too_long[key] is None


def test_too_long_vendor_is_left_out_of_the_description():
    mapped = to_bill_create_dict(clean_extraction(vendor_name=ex("A" * 201)))
    assert mapped["description"] == "service period 2026-09-13 to 2026-10-12"


def test_values_are_stripped():
    mapped = to_bill_create_dict(
        clean_extraction(vendor_name=ex("  Brightwater Utilities \n"))
    )
    assert mapped["vendor_name_raw"] == "Brightwater Utilities"


def test_processing_notes_list_the_issues():
    issues = [
        Issue(
            code=IssueCode.BAD_DATE, field="due_date", message="due_date is not a date"
        ),
        Issue(
            code=IssueCode.BALANCE_MISMATCH, field="amount_due", message="no balance"
        ),
    ]
    notes = to_bill_create_dict(clean_extraction(), issues)["processing_notes"]
    assert notes == (
        "BAD_DATE (due_date): due_date is not a date; "
        "BALANCE_MISMATCH (amount_due): no balance"
    )


def test_processing_notes_fit_billcreate_limit():
    issues = [Issue(code=IssueCode.BAD_DATE, field="due_date", message="x" * 500)] * 10
    notes = to_bill_create_dict(clean_extraction(), issues)["processing_notes"]
    assert len(notes) == 2000
    validate_with_bill_create(to_bill_create_dict(clean_extraction(), issues))

"""The eval scorer and runner helpers. Pure functions: no model is called."""

import copy
from datetime import date
from typing import Any

import pytest
from bill_factory import clean_extraction, ex, not_an_invoice

from backend.evals import run
from backend.evals.scoring import (
    normalize_string,
    percentile,
    score_bill,
    summarize,
    value_matches,
)
from backend.extraction.extract import CascadeResult
from backend.extraction.schema import (
    BillExtraction,
    ExtractionResult,
    ExtractionStatus,
    Issue,
    IssueCode,
    LineItem,
)

# The answer key for bill_factory.clean_extraction().
KEY: dict[str, Any] = {
    "document_type": "invoice",
    "vendor_name": "Brightwater Utilities",
    "account_number": "88-2110-4471",
    "invoice_number": "BW-4471-2611",
    "invoice_date": "2026-10-20",
    "due_date": "2026-11-10",
    "amount_due": "5680.00",
    "previous_balance": "1520.00",
    "payments_received": "1520.00",
    "current_charges": "5680.00",
    "line_items": [
        {"description": "Water service", "amount": "5000.00"},
        {"description": "Sewer service", "amount": "680.00"},
    ],
    "service_address": "2110 Example Ave, Dallas, TX 75201",
    "service_period_start": "2026-09-13",
    "service_period_end": "2026-10-12",
    "expected_issues": [],
    "expected_status": "ready_for_review",
}


def key(**overrides: Any) -> dict[str, Any]:
    return {**copy.deepcopy(KEY), **overrides}


def issue(code: IssueCode, field: str) -> Issue:
    return Issue(code=code, field=field, message="m")


def result(
    extraction: BillExtraction | None = None,
    status: ExtractionStatus = ExtractionStatus.ready_for_review,
    issues: list[Issue] | None = None,
    **extra: Any,
) -> ExtractionResult:
    if extraction is None and status != ExtractionStatus.failed:
        extraction = clean_extraction()
    return ExtractionResult(
        status=status, extraction=extraction, issues=issues or [], **extra
    )


# Value matching


def test_strings_match_after_trimming_and_collapsing_whitespace():
    assert normalize_string("  Brightwater \n  Utilities ") == "Brightwater Utilities"
    assert value_matches(
        "vendor_name", "Brightwater Utilities", " Brightwater  Utilities"
    )
    assert not value_matches("vendor_name", "Brightwater Utilities", "Brightwater")


def test_strings_are_case_sensitive():
    assert not value_matches("vendor_name", "Brightwater", "BRIGHTWATER")


@pytest.mark.parametrize(
    ("name", "expected", "actual"),
    [
        ("amount_due", "1180.50", "1,180.50"),
        ("amount_due", "1180.50", "1180.5"),
        ("amount_due", "1180.50", " 1180.50"),
        ("amount_due", "5680.00", "$5,680.00"),
        ("due_date", "2026-11-10", "2026-11-10 "),
    ],
)
def test_dates_and_amounts_match_by_parsed_value(name: str, expected: str, actual):
    assert value_matches(name, expected, actual)


@pytest.mark.parametrize(
    ("name", "expected", "actual"),
    [
        ("amount_due", "1180.50", "1180.51"),
        ("amount_due", "1180.50", "-1180.50"),
        ("amount_due", "1180.50", "abc"),
        ("due_date", "2026-11-10", "11/10/2026"),  # not a value the form accepts
        ("due_date", "2026-11-10", "2026-11-11"),
        ("document_type", "invoice", "not_an_invoice"),
    ],
)
def test_dates_and_amounts_with_another_value_do_not_match(name: str, expected, actual):
    assert not value_matches(name, expected, actual)


def test_expected_null_must_come_back_null():
    assert value_matches("service_address", None, None)
    assert not value_matches("service_address", None, "2110 Example Ave")
    assert not value_matches("service_address", None, "")
    assert not value_matches("service_address", "2110 Example Ave", None)


# Bill scores


def test_a_perfect_clean_bill():
    score = score_bill("b", KEY, result(cost_usd=0.001, latency_ms=1200))
    assert score.misses == ()
    assert score.fields_correct == score.fields_total == 13  # 12 values + type
    assert score.required_correct == score.required_total == 6
    assert score.silent_errors == ()
    assert score.status_match and score.is_clean
    assert score.line_items_match
    assert (score.cost_usd, score.latency_ms) == (0.001, 1200)


def test_a_wrong_required_field_without_an_issue_is_a_silent_error():
    extraction = clean_extraction(account_number=ex("88-2110-4417"))
    score = score_bill("b", KEY, result(extraction))
    assert [m.field for m in score.misses] == ["account_number"]
    assert score.required_correct == 5
    assert score.silent_errors == ("account_number",)


def test_a_wrong_required_field_with_an_issue_on_it_is_not_silent():
    extraction = clean_extraction(amount_due=ex("5000.00"))
    flagged = result(
        extraction,
        ExtractionStatus.needs_attention,
        [issue(IssueCode.BALANCE_MISMATCH, "amount_due")],
    )
    score = score_bill("b", KEY, flagged)
    assert score.required_correct == 5
    assert score.silent_errors == ()
    assert score.misses[0].flagged


def test_an_issue_on_another_field_does_not_cover_a_wrong_one():
    extraction = clean_extraction(due_date=ex("2026-11-01"))
    other = [issue(IssueCode.LOW_CONFIDENCE, "vendor_name")]
    score = score_bill(
        "b", KEY, result(extraction, ExtractionStatus.needs_attention, other)
    )
    assert score.silent_errors == ("due_date",)


def test_a_wrong_optional_field_is_not_a_required_error():
    extraction = clean_extraction(service_period_end=ex("2026-10-13"))
    score = score_bill("b", KEY, result(extraction))
    assert score.required_correct == 6
    assert score.fields_correct == 12
    assert score.silent_errors == ()


def test_a_failed_extraction_gets_every_value_wrong_but_none_silent():
    failed = result(status=ExtractionStatus.failed, failed_reason="model timeout")
    score = score_bill("b", KEY, failed)
    assert score.required_correct == 0
    assert score.fields_correct == 0
    assert score.silent_errors == ()
    assert score.failed_reason == "model timeout"
    assert not score.status_match


def test_not_an_invoice_key_scores_null_fields_as_correct():
    letter_key = key(
        document_type="not_an_invoice",
        line_items=[],
        expected_status="not_an_invoice",
        **{name: None for name in ("vendor_name", "account_number", "invoice_number")},
        **{name: None for name in ("invoice_date", "due_date", "amount_due")},
        **{name: None for name in ("previous_balance", "payments_received")},
        **{name: None for name in ("current_charges", "service_address")},
        **{name: None for name in ("service_period_start", "service_period_end")},
    )
    score = score_bill(
        "letter", letter_key, result(not_an_invoice(), ExtractionStatus.not_an_invoice)
    )
    assert score.misses == ()
    assert score.status_match
    assert not score.is_clean


def test_an_invoice_called_not_an_invoice_is_silent():
    score = score_bill(
        "b", KEY, result(not_an_invoice(), ExtractionStatus.not_an_invoice)
    )
    assert score.silent_errors == (
        "vendor_name",
        "account_number",
        "invoice_number",
        "invoice_date",
        "due_date",
        "amount_due",
    )
    assert "document_type" in {m.field for m in score.misses}


def test_a_wrong_invoice_date_is_a_required_error():
    extraction = clean_extraction(invoice_date=ex("2026-10-21"))
    score = score_bill("b", KEY, result(extraction))
    assert score.silent_errors == ("invoice_date",)


def test_planted_problems_are_caught_when_the_code_is_raised():
    planted_key = key(
        expected_issues=["BALANCE_MISMATCH", "LINE_ITEMS_MISMATCH"],
        expected_status="needs_attention",
    )
    found = result(
        status=ExtractionStatus.needs_attention,
        issues=[issue(IssueCode.BALANCE_MISMATCH, "amount_due")],
    )
    score = score_bill("b", planted_key, found)
    assert score.planted == ("BALANCE_MISMATCH", "LINE_ITEMS_MISMATCH")
    assert score.caught == ("BALANCE_MISMATCH",)
    assert score.status_match


def test_line_items_compare_amounts_as_a_multiset():
    swapped = clean_extraction(
        line_items=[
            LineItem(description=ex("Sewer"), amount=ex("680.00")),
            LineItem(description=ex("Water service"), amount=ex("5000.00")),
        ]
    )
    score = score_bill("b", KEY, result(swapped))
    assert score.line_items_match  # order and descriptions are not scored
    assert score.line_item_descriptions_missed == ("Sewer service",)

    duplicated = clean_extraction(
        line_items=[
            LineItem(description=ex("Water service"), amount=ex("5000.00")),
            LineItem(description=ex("Water service"), amount=ex("5000.00")),
        ]
    )
    assert not score_bill("b", KEY, result(duplicated)).line_items_match
    assert not score_bill(
        "b", KEY, result(clean_extraction(line_items=[]))
    ).line_items_match


def test_line_item_amounts_compare_by_parsed_value():
    formatted = clean_extraction(
        line_items=[
            LineItem(description=ex("Water service"), amount=ex("$5,000.00")),
            LineItem(description=ex("Sewer service"), amount=ex("680")),
        ]
    )
    assert score_bill("b", KEY, result(formatted)).line_items_match


def test_cost_and_latency_overrides_for_a_cascade():
    score = score_bill(
        "b", KEY, result(cost_usd=0.001, latency_ms=900), cost_usd=0.02, latency_ms=4000
    )
    assert (score.cost_usd, score.latency_ms) == (0.02, 4000)


# Summary


def test_percentile_is_nearest_rank():
    values = [float(v) for v in range(1, 21)]  # 1..20
    assert percentile(values, 95) == 19.0
    assert percentile(values, 50) == 10.0
    assert percentile([5.0], 95) == 5.0
    assert percentile([], 95) == 0.0


def test_summary_measures():
    planted_key = key(
        expected_issues=["BALANCE_MISMATCH"], expected_status="needs_attention"
    )
    scores = [
        # clean and right
        score_bill("a", KEY, result(cost_usd=0.001, latency_ms=1000)),
        # clean but held, with a flagged wrong amount
        score_bill(
            "b",
            KEY,
            result(
                clean_extraction(amount_due=ex("5000.00")),
                ExtractionStatus.needs_attention,
                [issue(IssueCode.BALANCE_MISMATCH, "amount_due")],
                cost_usd=0.002,
                latency_ms=2000,
            ),
        ),
        # clean, silent wrong account number
        score_bill(
            "c",
            KEY,
            result(
                clean_extraction(account_number=ex("x")),
                cost_usd=0.003,
                latency_ms=3000,
            ),
        ),
        # planted problem missed
        score_bill("d", planted_key, result(cost_usd=0.004, latency_ms=4000)),
        # failed
        score_bill(
            "e", KEY, result(status=ExtractionStatus.failed, failed_reason="timeout")
        ),
    ]
    summary = summarize(scores)
    assert summary.bills == 5
    assert summary.required_accuracy == pytest.approx((6 + 5 + 5 + 6 + 0) / 30)
    assert summary.silent_errors == 1
    assert (summary.clean_bills, summary.clean_held) == (4, 1)
    assert summary.clean_held_rate == pytest.approx(0.25)
    assert (summary.planted, summary.caught) == (1, 0)
    assert summary.status_matches == 2  # a and c
    assert summary.failed == 1
    assert summary.line_items_matches == 4
    assert summary.cost_median == pytest.approx(0.002)
    assert summary.cost_p95 == pytest.approx(0.004)
    assert summary.latency_median_ms == 2000
    assert summary.latency_p95_ms == 4000
    assert summary.per_field_accuracy["account_number"] == pytest.approx(3 / 5)


def test_empty_summary():
    summary = summarize([])
    assert summary.required_accuracy is None
    assert summary.clean_held_rate is None


# Runner helpers


def test_model_spec_parsing():
    assert run.parse_model_spec("claude-haiku-5-5") == ("claude-haiku-5-5",)
    assert run.parse_model_spec("claude-haiku-5-5+claude-sonnet-5-5") == (
        "claude-haiku-5-5",
        "claude-sonnet-5-5",
    )
    with pytest.raises(ValueError, match="unknown model"):
        run.parse_model_spec("gpt-x")
    with pytest.raises(ValueError, match="exactly two"):
        run.parse_model_spec("claude-haiku-5-5+claude-sonnet-5-5+claude-opus-5-5")


def test_estimate_counts_cascade_calls_and_bounds_cost():
    calls, upper = run.estimate([2, 1], [("claude-haiku-5-5",)])
    assert calls == 2
    # (12000 + 7000) input x $0.10 + 2 x 8192 output x $0.50, per million
    assert upper == pytest.approx(0.0019 + 0.008192)
    calls, _ = run.estimate([2, 1], [("claude-haiku-5-5", "claude-sonnet-5-5")])
    assert calls == 4


def test_find_bills_defaults_to_dev_and_filters_by_glob():
    dev = run.find_bills("dev")
    assert dev and {b.split for b in dev} == {"dev"}
    assert {b.split for b in run.find_bills("all")} == {"dev", "holdout"}
    subset = run.find_bills("dev", "gen-electric-clean*")
    assert [b.name for b in subset] == ["gen-electric-clean"]
    assert subset[0].media_type == "application/pdf"


def test_every_bill_has_an_answer_key():
    for bill in run.find_bills("all"):
        assert (run.BILLS_DIR / "expected" / f"{bill.name}.json").exists(), bill.name


def test_main_asks_before_calling_and_stops_on_no(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    def no_calls(*args: Any, **kwargs: Any):
        raise AssertionError("a model was called")

    monkeypatch.setattr(run, "extract_bill", no_calls)
    monkeypatch.setattr("builtins.input", lambda prompt: "n")
    code = run.main(["--model", "claude-haiku-5-5", "--bills", "gen-electric-clean*"])
    assert code == 1
    out = capsys.readouterr().out
    assert "up to 1 model calls, estimated cost at most $" in out
    assert "Cancelled" in out


def test_every_extract_call_gets_the_fixture_worlds_date(
    monkeypatch: pytest.MonkeyPatch,
):
    seen: list[Any] = []
    failed = result(status=ExtractionStatus.failed, failed_reason="fake")

    def fake_extract(*args: Any, **kwargs: Any) -> ExtractionResult:
        seen.append(kwargs["today"])
        return failed

    def fake_cascade(*args: Any, **kwargs: Any) -> CascadeResult:
        seen.append(kwargs["today"])
        return CascadeResult(failed, (failed,))

    monkeypatch.setattr(run, "extract_bill", fake_extract)
    monkeypatch.setattr(run, "extract_bill_cascade", fake_cascade)
    bill = run.find_bills("dev", "gen-electric-clean*")[0]
    run.run_bill(bill, ("claude-haiku-5-5",))
    run.run_bill(bill, ("claude-haiku-5-5", "claude-sonnet-5-5"))
    assert run.EVAL_TODAY == date(2026, 10, 29)
    assert seen == [run.EVAL_TODAY, run.EVAL_TODAY]


def test_details_show_a_failed_bill_as_one_line(capsys: pytest.CaptureFixture[str]):
    failed = result(status=ExtractionStatus.failed, failed_reason="model error 503")
    bill = run.find_bills("dev", "gen-electric-clean*")[0]
    score = score_bill(bill.name, KEY, failed)
    run.print_details("m", [run.BillRun(bill, failed, (failed,), score)])
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines == [
        "m: wrong fields per bill",
        "  gen-electric-clean: failed (model error 503)",
    ]


def test_details_show_silent_and_flagged_misses(capsys: pytest.CaptureFixture[str]):
    wrong = result(clean_extraction(account_number=ex("x")))
    bill = run.find_bills("dev", "gen-electric-clean*")[0]
    score = score_bill(bill.name, KEY, wrong)
    run.print_details("m", [run.BillRun(bill, wrong, (wrong,), score)])
    out = capsys.readouterr().out
    assert "account_number: expected '88-2110-4471', got 'x' (SILENT)" in out

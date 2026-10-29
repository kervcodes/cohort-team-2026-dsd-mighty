"""Eval scoring, exactly per the DC-52 spec "Scoring" and "Measures and targets".

Pure functions: an answer key (`expected/<bill>.json` as a dict) and an
`ExtractionResult` in, scores out. Nothing here calls a model.

- Strings match after trimming and collapsing whitespace; dates and amounts
  must match exactly; an expected null must come back null.
- A failed extraction has no values, so every expected non-null field is wrong
  (but never silent: the person sees `failed`).
- Line items are compared as a multiset of amounts; descriptions are reported,
  not scored.
"""

import math
import re
import statistics
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from backend.extraction.schema import (
    AMOUNT_FIELDS,
    DATE_FIELDS,
    FIELD_NAMES,
    REQUIRED_FIELDS,
    ExtractionResult,
    ExtractionStatus,
)

SCORED_FIELDS = ("document_type", *FIELD_NAMES)
_EXACT_FIELDS = frozenset((*DATE_FIELDS, *AMOUNT_FIELDS, "document_type"))
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_string(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def value_matches(name: str, expected: str | None, actual: str | None) -> bool:
    if expected is None or actual is None:
        return expected is None and actual is None
    if name in _EXACT_FIELDS:
        return expected == actual
    return normalize_string(expected) == normalize_string(actual)


def actual_values(result: ExtractionResult) -> dict[str, str | None]:
    """Field values from the result; all None when there is no extraction."""
    extraction = result.extraction
    if extraction is None:
        return dict.fromkeys(SCORED_FIELDS)
    values: dict[str, str | None] = {"document_type": extraction.document_type.value}
    for name in FIELD_NAMES:
        values[name] = getattr(extraction, name).value
    return values


@dataclass(frozen=True)
class FieldMiss:
    field: str
    expected: str | None
    actual: str | None
    flagged: bool  # an issue was raised on this field


@dataclass(frozen=True)
class BillScore:
    bill: str
    status: str
    expected_status: str
    failed_reason: str | None
    fields_total: int
    fields_correct: int
    required_total: int
    required_correct: int
    misses: tuple[FieldMiss, ...]
    silent_errors: tuple[str, ...]  # required fields wrong with no issue raised
    is_clean: bool  # the key expects ready_for_review
    planted: tuple[str, ...]  # expected issue codes
    caught: tuple[str, ...]  # expected issue codes present in the result
    line_items_match: bool
    line_item_descriptions_missed: tuple[str, ...]  # reported, not scored
    cost_usd: float
    latency_ms: int

    @property
    def status_match(self) -> bool:
        return self.status == self.expected_status


def score_bill(
    bill: str,
    expected: dict[str, Any],
    result: ExtractionResult,
    *,
    cost_usd: float | None = None,
    latency_ms: int | None = None,
) -> BillScore:
    """Score one result. `cost_usd` and `latency_ms` default to the result's own
    (a cascade passes the total of every attempt)."""
    actual = actual_values(result)
    flagged_fields = {issue.field for issue in result.issues}
    failed = result.status == ExtractionStatus.failed

    misses = tuple(
        FieldMiss(name, expected[name], actual[name], name in flagged_fields)
        for name in SCORED_FIELDS
        if not value_matches(name, expected[name], actual[name])
    )
    missed = {miss.field for miss in misses}
    silent = (
        ()
        if failed
        else tuple(
            name
            for name in REQUIRED_FIELDS
            if name in missed and name not in flagged_fields
        )
    )

    result_codes = {issue.code.value for issue in result.issues}
    planted = tuple(expected["expected_issues"])
    expected_items = expected["line_items"]
    actual_items = result.extraction.line_items if result.extraction else []

    return BillScore(
        bill=bill,
        status=result.status.value,
        expected_status=expected["expected_status"],
        failed_reason=result.failed_reason,
        fields_total=len(SCORED_FIELDS),
        fields_correct=len(SCORED_FIELDS) - len(misses),
        required_total=len(REQUIRED_FIELDS),
        required_correct=len(REQUIRED_FIELDS) - len(missed & set(REQUIRED_FIELDS)),
        misses=misses,
        silent_errors=silent,
        is_clean=expected["expected_status"] == ExtractionStatus.ready_for_review,
        planted=planted,
        caught=tuple(code for code in planted if code in result_codes),
        line_items_match=Counter(i["amount"] for i in expected_items)
        == Counter(i.amount.value for i in actual_items),
        line_item_descriptions_missed=tuple(
            sorted(
                (
                    Counter(normalize_string(i["description"]) for i in expected_items)
                    - Counter(
                        normalize_string(i.description.value or "")
                        for i in actual_items
                    )
                ).elements()
            )
        ),
        cost_usd=(result.cost_usd or 0.0) if cost_usd is None else cost_usd,
        latency_ms=(result.latency_ms or 0) if latency_ms is None else latency_ms,
    )


def percentile(values: Sequence[float], p: float) -> float:
    """Nearest-rank percentile; 0 for no values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(math.ceil(p / 100 * len(ordered)) - 1, 0)]


def _rate(part: int, whole: int) -> float | None:
    return part / whole if whole else None


@dataclass(frozen=True)
class Summary:
    bills: int
    field_accuracy: float | None
    required_accuracy: float | None  # target >= 95%
    silent_errors: int  # target 0
    clean_bills: int
    clean_held: int  # clean bills with status needs_attention; target <= 20%
    planted: int
    caught: int  # target: all
    status_matches: int
    failed: int
    line_items_matches: int
    cost_median: float
    cost_p95: float
    latency_median_ms: float
    latency_p95_ms: float
    per_field_accuracy: dict[str, float] = field(default_factory=dict)

    @property
    def clean_held_rate(self) -> float | None:
        return _rate(self.clean_held, self.clean_bills)


def summarize(scores: Sequence[BillScore]) -> Summary:
    misses = Counter(miss.field for s in scores for miss in s.misses)
    costs = [s.cost_usd for s in scores]
    latencies = [float(s.latency_ms) for s in scores]
    return Summary(
        bills=len(scores),
        field_accuracy=_rate(
            sum(s.fields_correct for s in scores), sum(s.fields_total for s in scores)
        ),
        required_accuracy=_rate(
            sum(s.required_correct for s in scores),
            sum(s.required_total for s in scores),
        ),
        silent_errors=sum(len(s.silent_errors) for s in scores),
        clean_bills=sum(s.is_clean for s in scores),
        clean_held=sum(
            s.is_clean and s.status == ExtractionStatus.needs_attention for s in scores
        ),
        planted=sum(len(s.planted) for s in scores),
        caught=sum(len(s.caught) for s in scores),
        status_matches=sum(s.status_match for s in scores),
        failed=sum(s.status == ExtractionStatus.failed for s in scores),
        line_items_matches=sum(s.line_items_match for s in scores),
        cost_median=statistics.median(costs) if costs else 0.0,
        cost_p95=percentile(costs, 95),
        latency_median_ms=statistics.median(latencies) if latencies else 0.0,
        latency_p95_ms=percentile(latencies, 95),
        per_field_accuracy={
            name: 1 - misses[name] / len(scores) for name in SCORED_FIELDS
        }
        if scores
        else {},
    )

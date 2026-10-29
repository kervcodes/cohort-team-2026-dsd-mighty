"""Run the DC-52 extraction eval by hand. Calls real models and costs money.

    uv run python -m backend.evals.run --model claude-haiku-5-5
    uv run python -m backend.evals.run --model claude-haiku-5-5+claude-sonnet-5-5

`--model` is repeatable; `a+b` is the cascade (b only when a needs attention).
`--split` is dev by default: holdout runs only when asked for. Before any call
it prints the number of calls and a cost upper bound and asks to confirm.
Results go to `backend/evals/results/<UTC timestamp>-<model>.json`.
"""

import argparse
import fnmatch
import io
import json
import logging
import sys
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from backend.evals.scoring import BillScore, Summary, score_bill, summarize
from backend.extraction.extract import extract_bill, extract_bill_cascade
from backend.extraction.prompt import PROMPT_VERSION
from backend.extraction.providers import (
    MAX_OUTPUT_TOKENS,
    PRICES_PER_MILLION,
    Usage,
    cost_usd,
)
from backend.extraction.schema import ExtractionResult

BACKEND_DIR = Path(__file__).resolve().parents[3]
BILLS_DIR = BACKEND_DIR / "evals" / "bills"
RESULTS_DIR = BACKEND_DIR / "evals" / "results"
SPLITS = ("dev", "holdout")
MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

# Cost upper bound per call: a generous input size per page plus the prompt,
# and the full output cap. Retries are not counted.
INPUT_TOKENS_PER_PAGE_BOUND = 5000
PROMPT_TOKENS_BOUND = 2000


@dataclass(frozen=True)
class Bill:
    path: Path
    split: str

    @property
    def name(self) -> str:
        return self.path.stem

    @property
    def media_type(self) -> str:
        return MEDIA_TYPES[self.path.suffix.lower()]


def find_bills(split: str, pattern: str | None = None) -> list[Bill]:
    splits = SPLITS if split == "all" else (split,)
    bills = [
        Bill(path, name)
        for name in splits
        for path in sorted((BILLS_DIR / name).iterdir())
        if path.suffix.lower() in MEDIA_TYPES
    ]
    if pattern:
        bills = [b for b in bills if fnmatch.fnmatch(b.path.name, pattern)]
    return bills


def parse_model_spec(spec: str) -> tuple[str, ...]:
    """`a` is one model, `a+b` the cascade. Every model must have a price."""
    models = tuple(part.strip() for part in spec.split("+"))
    if len(models) > 2:
        raise ValueError(f"{spec!r}: a cascade has exactly two models")
    for model in models:
        if model not in PRICES_PER_MILLION:
            known = ", ".join(PRICES_PER_MILLION)
            raise ValueError(f"unknown model {model!r}; known: {known}")
    return models


def page_count(bill: Bill) -> int:
    if bill.media_type != "application/pdf":
        return 1
    return len(PdfReader(io.BytesIO(bill.path.read_bytes())).pages)


def estimate(
    pages: Sequence[int], specs: Sequence[tuple[str, ...]]
) -> tuple[int, float]:
    """(calls, cost upper bound in USD). A cascade counts both of its calls."""
    calls, total = 0, 0.0
    for models in specs:
        for model in models:
            for count in pages:
                usage = Usage(
                    count * INPUT_TOKENS_PER_PAGE_BOUND + PROMPT_TOKENS_BOUND,
                    MAX_OUTPUT_TOKENS,
                )
                calls += 1
                total += cost_usd(model, usage)
    return calls, total


def load_expected(bill: Bill) -> dict[str, Any]:
    return json.loads((BILLS_DIR / "expected" / f"{bill.name}.json").read_text())


@dataclass(frozen=True)
class BillRun:
    bill: Bill
    result: ExtractionResult
    attempts: tuple[ExtractionResult, ...]
    score: BillScore


def run_bill(bill: Bill, models: tuple[str, ...]) -> BillRun:
    data = bill.path.read_bytes()
    expected = load_expected(bill)
    if len(models) == 1:
        result = extract_bill(data, bill.media_type, model=models[0])
        score = score_bill(bill.name, expected, result)
        return BillRun(bill, result, (result,), score)
    cascade = extract_bill_cascade(data, bill.media_type, models=models)
    score = score_bill(
        bill.name,
        expected,
        cascade.result,
        cost_usd=cascade.cost_usd,
        latency_ms=cascade.latency_ms,
    )
    return BillRun(bill, cascade.result, cascade.attempts, score)


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{value:.0%}"


def summary_rows(summary: Summary) -> list[tuple[str, str]]:
    s = summary
    return [
        ("bills", str(s.bills)),
        ("required fields correct (>=95%)", _pct(s.required_accuracy)),
        ("silent errors (0)", str(s.silent_errors)),
        (
            "clean held as needs_attention (<=20%)",
            f"{s.clean_held}/{s.clean_bills} {_pct(s.clean_held_rate)}",
        ),
        ("planted problems caught (all)", f"{s.caught}/{s.planted}"),
        ("status match", f"{s.status_matches}/{s.bills}"),
        ("failed", str(s.failed)),
        ("line items match (amounts)", f"{s.line_items_matches}/{s.bills}"),
        ("all fields correct", _pct(s.field_accuracy)),
        ("cost per bill median / p95", f"${s.cost_median:.4f} / ${s.cost_p95:.4f}"),
        (
            "latency median / p95",
            f"{s.latency_median_ms / 1000:.1f}s / {s.latency_p95_ms / 1000:.1f}s",
        ),
    ]


def print_table(summaries: dict[str, Summary]) -> None:
    columns = list(summaries)
    rows = {spec: dict(summary_rows(summary)) for spec, summary in summaries.items()}
    labels = [label for label, _ in summary_rows(next(iter(summaries.values())))]
    widths = [max(len(label) for label in labels)] + [
        max(len(spec), *(len(v) for v in rows[spec].values())) for spec in columns
    ]
    lines = [["measure", *columns]]
    lines += [[label, *(rows[spec][label] for spec in columns)] for label in labels]
    for cells in lines:
        print(
            "  ".join(c.ljust(w) for c, w in zip(cells, widths, strict=True)).rstrip()
        )


def print_details(spec: str, runs: Sequence[BillRun]) -> None:
    print(f"\n{spec}: wrong fields per bill")
    printed = False
    for run in runs:
        s = run.score
        if s.failed_reason:  # no values to compare: the reason says it all
            printed = True
            print(f"  {s.bill}: failed ({s.failed_reason})")
            continue
        notes = []
        if not s.status_match:
            notes.append(f"status {s.status} (expected {s.expected_status})")
        missed_codes = sorted(set(s.planted) - set(s.caught))
        if missed_codes:
            notes.append(f"planted not caught: {', '.join(missed_codes)}")
        if not s.line_items_match:
            notes.append("line item amounts differ")
        if not (s.misses or notes):
            continue
        printed = True
        print(f"  {s.bill}: {'; '.join(notes)}" if notes else f"  {s.bill}:")
        for miss in s.misses:
            if miss.flagged:
                tag = "flagged"
            elif miss.field in s.silent_errors:
                tag = "SILENT"
            else:
                tag = "not flagged"
            got = f"expected {miss.expected!r}, got {miss.actual!r}"
            print(f"    {miss.field}: {got} ({tag})")
        for description in s.line_item_descriptions_missed:
            print(f"    line item description not matched: {description!r}")
    if not printed:
        print("  none")


def write_results(
    spec: str, split: str, runs: Sequence[BillRun], summary: Summary, now: datetime
) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{now.strftime('%Y%m%dT%H%M%SZ')}-{spec}.json"
    payload = {
        "model": spec,
        "prompt_version": PROMPT_VERSION,
        "split": split,
        "run_at": now.isoformat(),
        "summary": {**asdict(summary), "clean_held_rate": summary.clean_held_rate},
        "bills": [
            {
                "bill": run.bill.name,
                "split": run.bill.split,
                "score": asdict(run.score),
                "result": run.result.model_dump(mode="json"),
                "attempts": [a.model_dump(mode="json") for a in run.attempts],
            }
            for run in runs
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def confirm(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() in ("y", "yes")
    except EOFError:
        return False


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.evals.run")
    parser.add_argument(
        "--model",
        action="append",
        required=True,
        help="model id, or a+b for the cascade; repeatable",
    )
    parser.add_argument("--split", choices=("dev", "holdout", "all"), default="dev")
    parser.add_argument("--bills", help="glob on the bill file name, e.g. 'gen-*'")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--yes", action="store_true", help="skip the cost prompt")
    args = parser.parse_args(argv)

    try:
        specs = {spec: parse_model_spec(spec) for spec in args.model}
    except ValueError as error:
        parser.error(str(error))
    bills = find_bills(args.split, args.bills)
    if not bills:
        parser.error("no bills match")
    missing = [
        b.name
        for b in bills
        if not (BILLS_DIR / "expected" / f"{b.name}.json").exists()
    ]
    if missing:
        parser.error(f"no answer key for: {', '.join(missing)}")

    calls, upper_bound = estimate([page_count(b) for b in bills], list(specs.values()))
    print(
        f"{len(bills)} bills ({args.split}) x {len(specs)} model setting(s): "
        f"up to {calls} model calls, estimated cost at most ${upper_bound:.4f}",
        flush=True,
    )
    if not args.yes and not confirm("Proceed? [y/N] "):
        print("Cancelled; no model was called.")
        return 1

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    logging.getLogger("backend.extraction").setLevel(logging.INFO)
    now = datetime.now(UTC)
    summaries: dict[str, Summary] = {}
    all_runs: dict[str, list[BillRun]] = {}
    with ThreadPoolExecutor(max_workers=max(args.concurrency, 1)) as pool:
        for spec, models in specs.items():
            runs = list(pool.map(lambda bill, m=models: run_bill(bill, m), bills))
            all_runs[spec] = runs
            summaries[spec] = summarize([run.score for run in runs])

    print()
    print_table(summaries)
    for spec, runs in all_runs.items():
        print_details(spec, runs)
    print()
    for spec, runs in all_runs.items():
        path = write_results(spec, args.split, runs, summaries[spec], now)
        print(f"results: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

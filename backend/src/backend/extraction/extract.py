"""`extract_bill`: pre-checks, model call, parse, checks, status (DC-52).

Never raises for a bad file, a model error, a timeout or output that does not
fit the schema: those return status `failed` with `failed_reason`. It raises
only for configuration errors: an unknown model, or `MissingApiKeyError`.

Every call logs one line with model, prompt version, file hash, tokens, cost,
latency and status. Never bill content or extracted values.

This module must not import Supabase (see ENFORCEMENT.md).
"""

import hashlib
import io
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from pypdf import PdfReader

from backend.extraction.checks import cap_confidence, has_text_layer, run_checks
from backend.extraction.prompt import PROMPT_VERSION
from backend.extraction.providers import (
    CLAUDE_HAIKU,
    CLAUDE_SONNET,
    PRICES_PER_MILLION,
    PROVIDERS,
    Provider,
    ProviderError,
    Usage,
    cost_usd,
)
from backend.extraction.schema import ExtractionResult, ExtractionStatus
from backend.extraction.status import decide_status

logger = logging.getLogger(__name__)

PDF = "application/pdf"
MEDIA_TYPES = (PDF, "image/png", "image/jpeg")
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 5


class _Rejected(Exception):
    """A pre-check failed; the message is the failed_reason."""


def _pdf_text_layer(data: bytes) -> str:
    """Page count check and text layer. The file is untrusted input."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise _Rejected("the PDF is encrypted")
        pages = len(reader.pages)
        if pages > MAX_PAGES:
            raise _Rejected(f"the PDF has {pages} pages; at most {MAX_PAGES}")
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except _Rejected:
        raise
    except Exception as error:  # pypdf raises many types on malformed files
        raise _Rejected("the PDF could not be read") from error


def _pre_check(data: bytes, media_type: str) -> str | None:
    """The PDF text layer, or None for images. Raises `_Rejected`."""
    if media_type not in MEDIA_TYPES:
        raise _Rejected(f"unsupported file type {media_type!r}")
    if not data:
        raise _Rejected("the file is empty")
    if len(data) > MAX_BYTES:
        raise _Rejected(f"the file is larger than {MAX_BYTES // (1024 * 1024)} MB")
    return _pdf_text_layer(data) if media_type == PDF else None


def extract_bill(
    data: bytes,
    media_type: str,
    *,
    model: str,
    provider: Provider | None = None,
    today: date | None = None,
) -> ExtractionResult:
    """Read one bill with one model call and return checked, structured output.

    `provider` replaces the registered model call (tests inject a fake one);
    `today` anchors the date-range check (defaults to the current date).
    """
    if model not in PRICES_PER_MILLION:
        raise ValueError(f"unknown model {model!r}")
    call = provider or PROVIDERS[model]
    started = time.perf_counter()
    result = ExtractionResult(
        status=ExtractionStatus.failed,
        model=model,
        prompt_version=PROMPT_VERSION,
        file_sha256=hashlib.sha256(data).hexdigest(),
    )
    try:
        result = _extract(data, media_type, model, call, today, result)
    finally:
        result.latency_ms = round((time.perf_counter() - started) * 1000)
        _log(result)
    return result


def _extract(
    data: bytes,
    media_type: str,
    model: str,
    call: Provider,
    today: date | None,
    result: ExtractionResult,
) -> ExtractionResult:
    try:
        text_layer = _pre_check(data, media_type)
    except _Rejected as rejected:
        return result.model_copy(update={"failed_reason": str(rejected)})

    try:
        output = call(data, media_type, model=model)
    except ProviderError as error:
        return _with_usage(result, model, error.usage).model_copy(
            update={"failed_reason": error.reason}
        )

    extraction = output.extraction
    if not has_text_layer(text_layer):
        extraction = cap_confidence(extraction)
    issues = run_checks(extraction, text_layer=text_layer, today=today or date.today())
    return _with_usage(result, model, output.usage).model_copy(
        update={
            "status": decide_status(extraction, issues, failed_reason=None),
            "extraction": extraction,
            "issues": issues,
        }
    )


def _with_usage(
    result: ExtractionResult, model: str, usage: Usage | None
) -> ExtractionResult:
    if usage is None:
        return result
    return result.model_copy(
        update={
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cost_usd": cost_usd(model, usage),
        }
    )


def _log(result: ExtractionResult) -> None:
    logger.info(
        "bill extraction model=%s prompt_version=%s file_sha256=%s "
        "input_tokens=%s output_tokens=%s cost_usd=%s latency_ms=%s status=%s",
        result.model,
        result.prompt_version,
        result.file_sha256,
        result.input_tokens,
        result.output_tokens,
        result.cost_usd,
        result.latency_ms,
        result.status.value,
    )


# Cascade: a cheap model first, a stronger one only when the checks find issues.

DEFAULT_CASCADE = (CLAUDE_HAIKU, CLAUDE_SONNET)

_STATUS_RANK = {
    ExtractionStatus.ready_for_review: 2,
    ExtractionStatus.needs_attention: 1,
    ExtractionStatus.not_an_invoice: 1,
    ExtractionStatus.failed: 0,
}


@dataclass(frozen=True)
class CascadeResult:
    result: ExtractionResult  # the better attempt, unchanged
    attempts: tuple[ExtractionResult, ...]  # every attempt, in call order

    @property
    def cost_usd(self) -> float:
        return round(sum(a.cost_usd or 0.0 for a in self.attempts), 6)

    @property
    def latency_ms(self) -> int:
        return sum(a.latency_ms or 0 for a in self.attempts)


def better(first: ExtractionResult, second: ExtractionResult) -> ExtractionResult:
    """Higher status wins, then fewer issues; a tie goes to `second` (the backup)."""
    rank = _STATUS_RANK[first.status], -len(first.issues)
    if rank > (_STATUS_RANK[second.status], -len(second.issues)):
        return first
    return second


def extract_bill_cascade(
    data: bytes,
    media_type: str,
    *,
    models: Sequence[str] = DEFAULT_CASCADE,
    providers: Sequence[Provider | None] | None = None,
    today: date | None = None,
) -> CascadeResult:
    """Run `models[0]`; only when it needs attention, re-run with `models[1]`."""
    cheap, backup = models
    cheap_provider, backup_provider = providers or (None, None)
    first = extract_bill(
        data, media_type, model=cheap, provider=cheap_provider, today=today
    )
    if first.status != ExtractionStatus.needs_attention:
        return CascadeResult(first, (first,))
    second = extract_bill(
        data, media_type, model=backup, provider=backup_provider, today=today
    )
    return CascadeResult(better(first, second), (first, second))

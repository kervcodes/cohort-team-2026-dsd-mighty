"""`extract_bill`: pre-checks, model call, parse, checks, status (DC-52).

Never raises for a bad file, a model error, a timeout or output that does not
fit the schema: those return status `failed` with `failed_reason`. It raises
only for configuration errors: an unknown model, or `MissingApiKeyError`.

Every call logs one line with model, prompt version, file hash, tokens, cost,
latency, status and failed reason. Never bill content or extracted values.

This module must not import Supabase (see ENFORCEMENT.md).
"""

import hashlib
import io
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from pypdf import PasswordType, PdfReader, PdfWriter, apply_configuration

from backend.extraction.checks import (
    cap_confidence,
    check_models_agree,
    has_text_layer,
    run_checks,
)
from backend.extraction.prompt import PROMPT_VERSION
from backend.extraction.providers import (
    CLAUDE_HAIKU,
    CLAUDE_SONNET,
    PRICES_PER_MILLION,
    PROVIDERS,
    MissingApiKeyError,
    Provider,
    ProviderError,
    Usage,
    cost_usd,
)
from backend.extraction.schema import ExtractionResult, ExtractionStatus
from backend.extraction.status import decide_status

logger = logging.getLogger(__name__)

PDF = "application/pdf"
PNG = "image/png"
JPEG = "image/jpeg"
MEDIA_TYPES = (PDF, PNG, JPEG)
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude's per-image limit
MAX_BYTES = {PDF: MAX_PDF_BYTES, PNG: MAX_IMAGE_BYTES, JPEG: MAX_IMAGE_BYTES}
MAX_PAGES = 5
MAX_TEXT_LAYER_CHARS = 200_000  # a longer text layer is not used
MAX_ECHOED_MEDIA_TYPE = 50  # the declared media type is caller input

# The file type comes from the first bytes; the declared type is not trusted.
_MAGIC = ((b"%PDF-", PDF), (b"\x89PNG\r\n\x1a\n", PNG), (b"\xff\xd8\xff", JPEG))

# pypdf limits for untrusted PDFs, far below its 75 MB defaults: a 5-page bill
# decodes to a few MB at most. Exceeding one raises, and the file is rejected.
_PDF_DECODED_LIMIT = 20 * 1024 * 1024
_PDF_LIMITS = {
    "maximum_declared_stream_length": MAX_PDF_BYTES,
    "array_based_stream_maximum_output_length": _PDF_DECODED_LIMIT,
    "jbig2_maximum_output_length": _PDF_DECODED_LIMIT,
    "lzw_maximum_output_length": _PDF_DECODED_LIMIT,
    "run_length_maximum_output_length": _PDF_DECODED_LIMIT,
    "zlib_maximum_output_length": _PDF_DECODED_LIMIT,
    "brotli_maximum_output_length": _PDF_DECODED_LIMIT,
    "image_maximum_buffer_size": _PDF_DECODED_LIMIT,
    "stream_decoding_work_maximum_length": 2 * _PDF_DECODED_LIMIT,
}


class _Rejected(Exception):
    """A pre-check failed; the message is the failed_reason."""


@dataclass(frozen=True)
class _Checked:
    """A file that passed the pre-checks."""

    data: bytes  # what the model gets: the upload, or a decrypted copy of it
    media_type: str  # detected from the bytes
    text_layer: str | None  # None for images and when the PDF's is unusable


def detect_media_type(data: bytes) -> str | None:
    """PDF, PNG or JPEG from the file's first bytes; None for anything else."""
    for magic, media_type in _MAGIC:
        if data.startswith(magic):
            return media_type
    return None


def _read_pdf(data: bytes) -> _Checked:
    """Encryption and page count checks, and the text layer. Untrusted input.

    An owner-password-only PDF (empty user password) is read, and the model
    gets a decrypted copy: Claude's PDF support takes only PDFs without
    passwords or encryption. A text layer longer than `MAX_TEXT_LAYER_CHARS`
    is treated as none. Every pypdf error becomes `_Rejected`.
    """
    try:
        with apply_configuration(**_PDF_LIMITS):
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                if reader.decrypt("") == PasswordType.NOT_DECRYPTED:
                    raise _Rejected("the PDF is password protected")
                decrypted = io.BytesIO()
                PdfWriter(clone_from=reader).write(decrypted)
                data = decrypted.getvalue()
            pages = len(reader.pages)
            if pages > MAX_PAGES:
                raise _Rejected(f"the PDF has {pages} pages; at most {MAX_PAGES}")
            return _Checked(data, PDF, _text_layer(reader))
    except _Rejected:
        raise
    except Exception as error:  # pypdf raises many types on malformed files
        raise _Rejected("the PDF could not be read") from error


def _text_layer(reader: PdfReader) -> str | None:
    texts: list[str] = []
    length = 0
    for page in reader.pages:
        texts.append(page.extract_text() or "")
        length += len(texts[-1])
        if length > MAX_TEXT_LAYER_CHARS:
            logger.warning(
                "bill extraction text layer over %s characters; not used",
                MAX_TEXT_LAYER_CHARS,
            )
            return None
    return "\n".join(texts)


def _detect_and_check_size(data: bytes, media_type: str) -> str:
    """The media type detected from the bytes. Raises `_Rejected`."""
    if media_type not in MEDIA_TYPES:
        echoed = media_type[:MAX_ECHOED_MEDIA_TYPE]
        raise _Rejected(f"unsupported file type {echoed!r}")
    if not data:
        raise _Rejected("the file is empty")
    detected = detect_media_type(data)
    if detected is None:
        raise _Rejected("the file is not a PDF, PNG or JPEG")
    limit = MAX_BYTES[detected]
    if len(data) > limit:
        raise _Rejected(f"the file is larger than {limit // (1024 * 1024)} MB")
    return detected


def extract_bill(
    data: bytes,
    media_type: str,
    *,
    model: str,
    provider: Provider | None = None,
    today: date | None = None,
) -> ExtractionResult:
    """Read one bill with one model call and return checked, structured output.

    `media_type` must be one of `MEDIA_TYPES`, but the file is handled as what
    its bytes are. `provider` replaces the registered model call (tests inject
    a fake one); `today` anchors the date-range check (defaults to the current
    date).
    """
    if model not in PRICES_PER_MILLION:
        raise ValueError(f"unknown model {model!r}")
    call = provider or PROVIDERS[model]
    started = time.perf_counter()
    result = ExtractionResult(
        status=ExtractionStatus.failed, model=model, prompt_version=PROMPT_VERSION
    )
    try:
        result = _extract(data, media_type, model, call, today, result)
    finally:
        result.latency_ms = round((time.perf_counter() - started) * 1000)
        _log(result)
    return result


def _pre_check(
    data: bytes, media_type: str, result: ExtractionResult
) -> tuple[_Checked | None, ExtractionResult]:
    """(the checked file or None, result with the file hash or failed reason)."""
    try:
        detected = _detect_and_check_size(data, media_type)
    except _Rejected as rejected:
        return None, result.model_copy(update={"failed_reason": str(rejected)})
    # Hashed only after the size check, so an oversized upload is never hashed.
    result = result.model_copy(update={"file_sha256": hashlib.sha256(data).hexdigest()})
    try:
        checked = _read_pdf(data) if detected == PDF else _Checked(data, detected, None)
    except _Rejected as rejected:
        return None, result.model_copy(update={"failed_reason": str(rejected)})
    return checked, result


def _extract(
    data: bytes,
    media_type: str,
    model: str,
    call: Provider,
    today: date | None,
    result: ExtractionResult,
) -> ExtractionResult:
    checked, result = _pre_check(data, media_type, result)
    if checked is None:
        return result

    try:
        output = call(checked.data, checked.media_type, model=model)
    except ProviderError as error:
        return _with_usage(result, model, error.usage).model_copy(
            update={"failed_reason": error.reason}
        )
    except MissingApiKeyError:
        raise
    except Exception as error:  # last resort: a model call never crashes a request
        # Only the type: an unknown error's message could echo the request.
        reason = f"unexpected model error ({type(error).__name__})"
        return result.model_copy(update={"failed_reason": reason})

    extraction = output.extraction
    if not has_text_layer(checked.text_layer):
        extraction = cap_confidence(extraction)
    issues = run_checks(
        extraction, text_layer=checked.text_layer, today=today or date.today()
    )
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
    # failed_reason never holds bill content: pre-check reasons are fixed text
    # (the echoed media type is capped), provider reasons are SDK messages or
    # counts, and an unexpected error is logged by type only.
    logger.info(
        "bill extraction model=%s prompt_version=%s file_sha256=%s "
        "input_tokens=%s output_tokens=%s cost_usd=%s latency_ms=%s status=%s "
        "failed_reason=%r",
        result.model,
        result.prompt_version,
        result.file_sha256,
        result.input_tokens,
        result.output_tokens,
        result.cost_usd,
        result.latency_ms,
        result.status.value,
        result.failed_reason,
    )


# Cascade: a cheap model first, a stronger one only when the checks find issues.

DEFAULT_CASCADE = (CLAUDE_HAIKU, CLAUDE_SONNET)


@dataclass(frozen=True)
class CascadeResult:
    result: ExtractionResult  # what the reviewer sees, see extract_bill_cascade
    attempts: tuple[ExtractionResult, ...]  # every attempt, unchanged, in order

    @property
    def cost_usd(self) -> float:
        return round(sum(a.cost_usd or 0.0 for a in self.attempts), 6)

    @property
    def latency_ms(self) -> int:
        return sum(a.latency_ms or 0 for a in self.attempts)


def combine(first: ExtractionResult, second: ExtractionResult) -> ExtractionResult:
    """The backup's result, plus MODELS_DISAGREE for every field the two read
    differently. Nothing either model found is dropped.

    Any disagreement makes it needs_attention (even when the backup says
    not_an_invoice). When the backup produced no extraction, the cheap result
    is kept as it is.
    """
    if first.extraction is None or second.extraction is None:
        return first if second.extraction is None else second
    disagreements = check_models_agree(first.extraction, second.extraction)
    issues = [*second.issues, *disagreements]
    status = (
        ExtractionStatus.needs_attention
        if disagreements
        else decide_status(second.extraction, issues, failed_reason=None)
    )
    return second.model_copy(update={"issues": issues, "status": status})


def _needs_second_read(first: ExtractionResult, data: bytes) -> bool:
    if first.status == ExtractionStatus.needs_attention:
        return True
    # A photo has no text layer to check evidence against, and a misread that
    # still adds up passes every check, so an independent read is the check.
    return first.extraction is not None and detect_media_type(data) in (PNG, JPEG)


def extract_bill_cascade(
    data: bytes,
    media_type: str,
    *,
    models: Sequence[str] = DEFAULT_CASCADE,
    providers: Sequence[Provider | None] | None = None,
    today: date | None = None,
) -> CascadeResult:
    """Run `models[0]`; re-run with `models[1]` and `combine` the two when it
    needs attention, and always for a photo."""
    cheap, backup = models
    cheap_provider, backup_provider = providers or (None, None)
    first = extract_bill(
        data, media_type, model=cheap, provider=cheap_provider, today=today
    )
    if not _needs_second_read(first, data):
        return CascadeResult(first, (first,))
    second = extract_bill(
        data, media_type, model=backup, provider=backup_provider, today=today
    )
    return CascadeResult(combine(first, second), (first, second))

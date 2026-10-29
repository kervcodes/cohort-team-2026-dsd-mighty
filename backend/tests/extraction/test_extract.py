import hashlib
import logging

import pytest
from bill_factory import TODAY, clean_extraction, ex, make_pdf

from backend.extraction.extract import (
    MAX_BYTES,
    better,
    extract_bill,
    extract_bill_cascade,
)
from backend.extraction.prompt import PROMPT_VERSION
from backend.extraction.providers import (
    CLAUDE_HAIKU,
    CLAUDE_SONNET,
    GEMINI_FLASH,
    InvalidOutputError,
    MissingApiKeyError,
    ProviderError,
    ProviderOutput,
    Usage,
)
from backend.extraction.schema import (
    BillExtraction,
    Confidence,
    ExtractionResult,
    ExtractionStatus,
    Issue,
    IssueCode,
)

USAGE = Usage(input_tokens=3000, output_tokens=1000)
PNG = b"\x89PNG\r\n\x1a\n fake image bytes"


class FakeProvider:
    """Stands in for a model call; records what it was asked."""

    def __init__(
        self,
        extraction: BillExtraction | None = None,
        error: ProviderError | None = None,
    ) -> None:
        self.extraction = extraction or clean_extraction()
        self.error = error
        self.calls: list[tuple[str, str]] = []

    def __call__(self, data: bytes, media_type: str, *, model: str) -> ProviderOutput:
        self.calls.append((media_type, model))
        if self.error:
            raise self.error
        return ProviderOutput(self.extraction, USAGE)


def run(data: bytes, media_type: str = "application/pdf", **kwargs):
    provider = kwargs.pop("provider", None) or FakeProvider()
    result = extract_bill(
        data,
        media_type,
        model=kwargs.pop("model", CLAUDE_HAIKU),
        provider=provider,
        today=TODAY,
    )
    return result, provider


def test_clean_pdf_is_ready_for_review_with_metadata():
    data = make_pdf()
    result, provider = run(data)
    assert result.status == ExtractionStatus.ready_for_review
    assert result.issues == []
    assert result.extraction == clean_extraction()
    assert result.failed_reason is None
    assert provider.calls == [("application/pdf", CLAUDE_HAIKU)]
    assert result.model == CLAUDE_HAIKU
    assert result.prompt_version == PROMPT_VERSION
    assert result.file_sha256 == hashlib.sha256(data).hexdigest()
    assert (result.input_tokens, result.output_tokens) == (3000, 1000)
    assert result.cost_usd == pytest.approx(0.0008)  # 3000 x $0.10 + 1000 x $0.50
    assert isinstance(result.latency_ms, int) and result.latency_ms >= 0


def test_issues_make_needs_attention():
    extraction = clean_extraction(amount_due=ex("5000.00"))  # balance is off
    result, _ = run(make_pdf(), provider=FakeProvider(extraction))
    assert result.status == ExtractionStatus.needs_attention
    assert IssueCode.BALANCE_MISMATCH in {issue.code for issue in result.issues}


def test_evidence_missing_from_pdf_text_layer_is_flagged():
    extraction = clean_extraction(vendor_name=ex("Brightwater", "Darkwater Inc"))
    result, _ = run(make_pdf(), provider=FakeProvider(extraction))
    assert [(i.code, i.field) for i in result.issues] == [
        (IssueCode.EVIDENCE_NOT_FOUND, "vendor_name")
    ]


def test_schema_invalid_output_fails_and_keeps_the_cost():
    error = InvalidOutputError("output did not fit the schema (2 errors)", USAGE)
    result, _ = run(make_pdf(), provider=FakeProvider(error=error))
    assert result.status == ExtractionStatus.failed
    assert result.failed_reason == "output did not fit the schema (2 errors)"
    assert result.extraction is None
    assert result.cost_usd == pytest.approx(0.0008)


def test_provider_error_fails_without_raising():
    error = ProviderError("model timeout: Request timed out.")
    result, _ = run(make_pdf(), provider=FakeProvider(error=error))
    assert result.status == ExtractionStatus.failed
    assert result.failed_reason == "model timeout: Request timed out."
    assert result.extraction is None
    assert result.cost_usd is None
    assert result.file_sha256 is not None


def test_image_caps_confidence_and_skips_the_evidence_check():
    # Evidence that appears nowhere: on a PDF this would be EVIDENCE_NOT_FOUND.
    extraction = clean_extraction(vendor_name=ex("Brightwater", "not on the bill"))
    result, provider = run(PNG, "image/png", provider=FakeProvider(extraction))
    assert provider.calls == [("image/png", CLAUDE_HAIKU)]
    assert result.status == ExtractionStatus.ready_for_review
    assert result.issues == []
    assert result.extraction is not None
    confidences = {field.confidence for _, field in result.extraction.iter_fields()}
    assert confidences == {Confidence.medium}


def test_jpeg_is_accepted():
    result, provider = run(b"\xff\xd8\xff fake jpeg", "image/jpeg")
    assert result.status == ExtractionStatus.ready_for_review
    assert provider.calls == [("image/jpeg", CLAUDE_HAIKU)]


@pytest.mark.parametrize(
    ("data", "media_type", "reason"),
    [
        (make_pdf(), "text/plain", "unsupported file type 'text/plain'"),
        (make_pdf(), "image/gif", "unsupported file type 'image/gif'"),
        (b"", "application/pdf", "the file is empty"),
        (b"%PDF" + b"0" * MAX_BYTES, "application/pdf", "larger than 10 MB"),
        (b"0" * (MAX_BYTES + 1), "image/png", "larger than 10 MB"),
        (make_pdf(pages=6), "application/pdf", "6 pages; at most 5"),
        (b"%PDF-1.7 this is not a pdf", "application/pdf", "could not be read"),
    ],
)
def test_pre_check_rejects_without_calling_the_provider(data, media_type, reason):
    result, provider = run(data, media_type)
    assert provider.calls == []
    assert result.status == ExtractionStatus.failed
    assert result.failed_reason is not None and reason in result.failed_reason
    assert result.file_sha256 == hashlib.sha256(data).hexdigest()
    assert result.cost_usd is None


def test_five_pages_is_allowed():
    result, provider = run(make_pdf(pages=5))
    assert len(provider.calls) == 1
    assert result.status == ExtractionStatus.ready_for_review


def test_exactly_10_mb_passes_the_size_check():
    result, provider = run(b"0" * MAX_BYTES, "image/png")
    assert len(provider.calls) == 1


@pytest.mark.parametrize(
    ("model", "var"),
    [(CLAUDE_HAIKU, "ANTHROPIC_API_KEY"), (GEMINI_FLASH, "GEMINI_API_KEY")],
)
def test_missing_api_key_raises(model: str, var: str):
    # The real provider: no key in the test run, and backend/.env cannot add one.
    with pytest.raises(MissingApiKeyError, match=var) as raised:
        extract_bill(make_pdf(), "application/pdf", model=model, today=TODAY)
    assert raised.value.var == var


def test_unknown_model_raises():
    with pytest.raises(ValueError, match="unknown model"):
        extract_bill(make_pdf(), "application/pdf", model="gpt-x")


def test_log_line_has_metadata_and_no_bill_content(caplog: pytest.LogCaptureFixture):
    data = make_pdf()
    with caplog.at_level(logging.INFO, logger="backend.extraction"):
        result, _ = run(data)
    assert len(caplog.records) == 1
    line = caplog.records[0].getMessage()
    for expected in (
        f"model={CLAUDE_HAIKU}",
        f"prompt_version={PROMPT_VERSION}",
        f"file_sha256={result.file_sha256}",
        "input_tokens=3000",
        "output_tokens=1000",
        "cost_usd=0.0008",
        f"latency_ms={result.latency_ms}",
        "status=ready_for_review",
    ):
        assert expected in line
    for _, field in clean_extraction().iter_fields():
        assert field.value is None or field.value not in line


def test_failed_calls_are_logged_too(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="backend.extraction"):
        run(b"", "application/pdf")
    assert "status=failed" in caplog.records[0].getMessage()


# Cascade


def result_with(status: ExtractionStatus, issues: int = 0) -> ExtractionResult:
    issue = Issue(code=IssueCode.BAD_DATE, field="due_date", message="bad")
    return ExtractionResult(status=status, issues=[issue] * issues)


def test_better_prefers_higher_status_then_fewer_issues_then_backup():
    ready = result_with(ExtractionStatus.ready_for_review)
    attention_1 = result_with(ExtractionStatus.needs_attention, 1)
    attention_2 = result_with(ExtractionStatus.needs_attention, 2)
    failed = result_with(ExtractionStatus.failed)
    assert better(attention_1, ready) is ready
    assert better(attention_1, failed) is attention_1
    assert better(attention_1, attention_2) is attention_1
    other = result_with(ExtractionStatus.needs_attention, 1)
    assert better(attention_1, other) is other


def cascade(cheap: FakeProvider, backup: FakeProvider):
    return extract_bill_cascade(
        make_pdf(),
        "application/pdf",
        models=(CLAUDE_HAIKU, CLAUDE_SONNET),
        providers=(cheap, backup),
        today=TODAY,
    )


def test_cascade_stops_when_the_cheap_model_is_ready():
    cheap, backup = FakeProvider(), FakeProvider()
    outcome = cascade(cheap, backup)
    assert backup.calls == []
    assert outcome.result.model == CLAUDE_HAIKU
    assert outcome.attempts == (outcome.result,)
    assert outcome.cost_usd == pytest.approx(0.0008)


def test_cascade_reruns_with_the_backup_when_issues_are_found():
    cheap = FakeProvider(clean_extraction(amount_due=ex("5000.00")))
    backup = FakeProvider()
    outcome = cascade(cheap, backup)
    assert len(backup.calls) == 1
    assert outcome.result.model == CLAUDE_SONNET
    assert outcome.result.status == ExtractionStatus.ready_for_review
    assert [a.model for a in outcome.attempts] == [CLAUDE_HAIKU, CLAUDE_SONNET]
    # Haiku 0.0008 + Sonnet (3000 x $2 + 1000 x $10) = 0.016
    assert outcome.cost_usd == pytest.approx(0.0168)
    assert outcome.latency_ms == sum(a.latency_ms or 0 for a in outcome.attempts)


def test_cascade_keeps_the_cheap_result_when_the_backup_fails():
    cheap = FakeProvider(clean_extraction(amount_due=ex("5000.00")))
    backup = FakeProvider(error=ProviderError("model timeout"))
    outcome = cascade(cheap, backup)
    assert outcome.result.model == CLAUDE_HAIKU
    assert outcome.result.status == ExtractionStatus.needs_attention
    assert len(outcome.attempts) == 2


def test_cascade_does_not_rerun_a_failed_call():
    cheap = FakeProvider(error=ProviderError("model timeout"))
    backup = FakeProvider()
    outcome = cascade(cheap, backup)
    assert backup.calls == []
    assert outcome.result.status == ExtractionStatus.failed

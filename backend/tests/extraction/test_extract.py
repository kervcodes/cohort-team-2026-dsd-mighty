import hashlib
import io
import logging

import pypdf
import pytest
from bill_factory import TODAY, clean_extraction, ex, make_pdf, not_an_invoice, null
from pypdf import PdfReader

from backend.extraction import extract
from backend.extraction.extract import (
    MAX_IMAGE_BYTES,
    MAX_PDF_BYTES,
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
    ExtractionStatus,
    IssueCode,
)

USAGE = Usage(input_tokens=3000, output_tokens=1000)
PNG = b"\x89PNG\r\n\x1a\n fake image bytes"
JPEG = b"\xff\xd8\xff fake jpeg"


class FakeProvider:
    """Stands in for a model call; records what it was asked."""

    def __init__(
        self,
        extraction: BillExtraction | None = None,
        error: Exception | None = None,
    ) -> None:
        self.extraction = extraction or clean_extraction()
        self.error = error
        self.calls: list[tuple[str, str]] = []
        self.data: list[bytes] = []

    def __call__(self, data: bytes, media_type: str, *, model: str) -> ProviderOutput:
        self.calls.append((media_type, model))
        self.data.append(data)
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
    extraction = clean_extraction(vendor_name=ex("Brightwater", "Brightwater Inc"))
    result, _ = run(make_pdf(), provider=FakeProvider(extraction))
    assert [(i.code, i.field) for i in result.issues] == [
        (IssueCode.EVIDENCE_NOT_FOUND, "vendor_name")
    ]


def test_value_that_its_evidence_does_not_show_is_flagged_on_a_photo():
    extraction = clean_extraction(amount_due=ex("5680.00", "Total due $5,860.00"))
    result, _ = run(PNG, "image/png", provider=FakeProvider(extraction))
    assert [(i.code, i.field) for i in result.issues] == [
        (IssueCode.EVIDENCE_MISMATCH, "amount_due")
    ]
    assert result.status == ExtractionStatus.needs_attention


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
    evidence = "Brightwater, not on the bill"
    extraction = clean_extraction(vendor_name=ex("Brightwater", evidence))
    result, provider = run(PNG, "image/png", provider=FakeProvider(extraction))
    assert provider.calls == [("image/png", CLAUDE_HAIKU)]
    assert result.status == ExtractionStatus.ready_for_review
    assert result.issues == []
    assert result.extraction is not None
    confidences = {field.confidence for _, field in result.extraction.iter_fields()}
    assert confidences == {Confidence.medium}


def test_jpeg_is_accepted():
    result, provider = run(JPEG, "image/jpeg")
    assert result.status == ExtractionStatus.ready_for_review
    assert provider.calls == [("image/jpeg", CLAUDE_HAIKU)]


# (data, declared media type, reason, hashed): the file is hashed only once it
# has passed the size check.
@pytest.mark.parametrize(
    ("data", "media_type", "reason", "hashed"),
    [
        (make_pdf(), "text/plain", "unsupported file type 'text/plain'", False),
        (make_pdf(), "image/gif", "unsupported file type 'image/gif'", False),
        (b"", "application/pdf", "the file is empty", False),
        (b"GIF89a not ours", "image/png", "not a PDF, PNG or JPEG", False),
        (b"plain text", "application/pdf", "not a PDF, PNG or JPEG", False),
        (
            b"%PDF-" + b"0" * MAX_PDF_BYTES,
            "application/pdf",
            "larger than 10 MB",
            False,
        ),
        (PNG + b"0" * MAX_IMAGE_BYTES, "image/png", "larger than 5 MB", False),
        (JPEG + b"0" * MAX_IMAGE_BYTES, "image/jpeg", "larger than 5 MB", False),
        (make_pdf(pages=6), "application/pdf", "6 pages; at most 5", True),
        (b"%PDF-1.7 this is not a pdf", "application/pdf", "could not be read", True),
        (
            make_pdf(user_password="user-secret"),
            "application/pdf",
            "the PDF is password protected",
            True,
        ),
    ],
    ids=[
        "text",
        "gif",
        "empty",
        "unknown-bytes",
        "text-declared-pdf",
        "pdf-too-big",
        "png-too-big",
        "jpeg-too-big",
        "too-many-pages",
        "unreadable-pdf",
        "password-protected",
    ],
)
def test_pre_check_rejects_without_calling_the_provider(
    data, media_type, reason, hashed
):
    result, provider = run(data, media_type)
    assert provider.calls == []
    assert result.status == ExtractionStatus.failed
    assert result.failed_reason is not None and reason in result.failed_reason
    expected_hash = hashlib.sha256(data).hexdigest() if hashed else None
    assert result.file_sha256 == expected_hash
    assert result.cost_usd is None


def test_echoed_media_type_is_capped():
    result, _ = run(make_pdf(), "x" * 500)
    assert result.failed_reason == f"unsupported file type {'x' * 50!r}"


def test_five_pages_is_allowed():
    result, provider = run(make_pdf(pages=5))
    assert len(provider.calls) == 1
    assert result.status == ExtractionStatus.ready_for_review


def test_exactly_5_mb_image_passes_the_size_check():
    data = PNG + b"0" * (MAX_IMAGE_BYTES - len(PNG))
    result, provider = run(data, "image/png")
    assert len(provider.calls) == 1
    assert result.file_sha256 == hashlib.sha256(data).hexdigest()


def test_a_pdf_may_be_larger_than_the_image_limit():
    data = make_pdf(padding=MAX_IMAGE_BYTES)
    assert MAX_IMAGE_BYTES < len(data) <= MAX_PDF_BYTES
    result, provider = run(data)
    assert len(provider.calls) == 1
    assert result.status == ExtractionStatus.ready_for_review


# Content, not the declared type, decides what the file is.


def test_a_pdf_declared_as_png_is_checked_as_a_pdf():
    result, provider = run(make_pdf(pages=50), "image/png")
    assert provider.calls == []
    assert result.failed_reason == "the PDF has 50 pages; at most 5"


def test_a_jpeg_declared_as_png_is_sent_as_a_jpeg():
    result, provider = run(JPEG, "image/png")
    assert provider.calls == [("image/jpeg", CLAUDE_HAIKU)]
    assert result.status == ExtractionStatus.ready_for_review


def test_a_pdf_declared_as_jpeg_gets_the_text_layer_checks():
    extraction = clean_extraction(vendor_name=ex("Brightwater", "Brightwater Inc"))
    result, provider = run(make_pdf(), "image/jpeg", provider=FakeProvider(extraction))
    assert provider.calls == [("application/pdf", CLAUDE_HAIKU)]
    assert IssueCode.EVIDENCE_NOT_FOUND in {i.code for i in result.issues}


# PDFs are untrusted input.


def test_owner_password_only_pdf_is_read_and_sent_decrypted():
    data = make_pdf(user_password="")
    result, provider = run(data)
    assert result.status == ExtractionStatus.ready_for_review  # text layer read
    assert result.file_sha256 == hashlib.sha256(data).hexdigest()  # of the upload
    sent = PdfReader(io.BytesIO(provider.data[0]))
    assert not sent.is_encrypted
    assert "Brightwater Utilities" in sent.pages[0].extract_text()


def test_decompression_bomb_is_rejected():
    # 30 MB of content stream in a file of about 30 KB.
    data = make_pdf(padding=30 * 1024 * 1024, compress=True)
    assert len(data) < 100_000
    result, provider = run(data)
    assert provider.calls == []
    assert result.failed_reason == "the PDF could not be read"


def test_pypdf_errors_during_text_extraction_fail_the_file(
    monkeypatch: pytest.MonkeyPatch,
):
    def broken(*args, **kwargs):
        raise pypdf.errors.PdfReadError("broken content stream")

    monkeypatch.setattr(pypdf.PageObject, "extract_text", broken)
    result, provider = run(make_pdf())
    assert provider.calls == []
    assert result.status == ExtractionStatus.failed
    assert result.failed_reason == "the PDF could not be read"


def test_an_oversized_text_layer_is_treated_as_none(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(extract, "MAX_TEXT_LAYER_CHARS", 100)
    extraction = clean_extraction(vendor_name=ex("Brightwater", "Brightwater Inc"))
    with caplog.at_level(logging.INFO, logger="backend.extraction"):
        result, _ = run(make_pdf(), provider=FakeProvider(extraction))
    # As for a photo: evidence is not looked up, confidence is capped.
    assert result.status == ExtractionStatus.ready_for_review
    assert result.extraction is not None
    assert result.extraction.vendor_name.confidence == Confidence.medium
    assert "text layer over 100 characters; not used" in caplog.text


# Errors from the model call never escape.


def test_an_unexpected_provider_exception_fails_with_its_type_only(
    caplog: pytest.LogCaptureFixture,
):
    error = KeyError("Brightwater Utilities 5680.00")
    with caplog.at_level(logging.INFO, logger="backend.extraction"):
        result, _ = run(make_pdf(), provider=FakeProvider(error=error))
    assert result.status == ExtractionStatus.failed
    assert result.failed_reason == "unexpected model error (KeyError)"
    assert "unexpected model error (KeyError)" in caplog.text
    assert "Brightwater" not in caplog.text


def test_missing_api_key_from_the_provider_is_not_swallowed():
    provider = FakeProvider(error=MissingApiKeyError("ANTHROPIC_API_KEY"))
    with pytest.raises(MissingApiKeyError):
        run(make_pdf(), provider=provider)


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
        "failed_reason=None",
    ):
        assert expected in line
    for _, field in clean_extraction().iter_fields():
        assert field.value is None or field.value not in line


def test_failed_calls_are_logged_with_the_reason(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="backend.extraction"):
        run(b"", "application/pdf")
    line = caplog.records[0].getMessage()
    assert "status=failed" in line
    assert "failed_reason='the file is empty'" in line


def test_logged_media_type_is_capped(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="backend.extraction"):
        run(make_pdf(), "x" * 49 + "LEAK" * 100)
    line = caplog.records[0].getMessage()
    assert "x" * 49 + "L'" in line  # the first 50 characters, then nothing
    assert "LEAK" not in line


# Cascade


def cascade(cheap: FakeProvider, backup: FakeProvider, *, photo: bool = False):
    return extract_bill_cascade(
        PNG if photo else make_pdf(),
        "image/png" if photo else "application/pdf",
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


def test_cascade_always_reads_a_photo_twice():
    cheap, backup = FakeProvider(), FakeProvider()
    outcome = cascade(cheap, backup, photo=True)
    assert outcome.attempts[0].status == ExtractionStatus.ready_for_review
    assert len(backup.calls) == 1
    assert outcome.result.model == CLAUDE_SONNET
    assert outcome.result.status == ExtractionStatus.ready_for_review


def test_cascade_flags_a_photo_whose_clean_reads_disagree():
    # Swapped dates: each read is self-consistent, so only the second read
    # shows the problem.
    swapped = clean_extraction(invoice_date=ex("2026-11-13"), due_date=ex("2026-11-13"))
    cheap, backup = FakeProvider(swapped), FakeProvider()
    outcome = cascade(cheap, backup, photo=True)
    assert outcome.attempts[0].status == ExtractionStatus.ready_for_review
    assert outcome.result.status == ExtractionStatus.needs_attention
    assert (IssueCode.MODELS_DISAGREE, "invoice_date") in {
        (i.code, i.field) for i in outcome.result.issues
    }


def test_cascade_takes_the_backup_when_both_models_agree():
    # Same values; only the cheap model was unsure, so only it had an issue.
    unsure = ex("BW-4471-2611", "Invoice # BW-4471-2611", Confidence.low)
    cheap = FakeProvider(clean_extraction(invoice_number=unsure))
    backup = FakeProvider()
    outcome = cascade(cheap, backup)
    assert len(backup.calls) == 1
    assert outcome.result.model == CLAUDE_SONNET
    assert outcome.result.status == ExtractionStatus.ready_for_review
    assert outcome.result.issues == []
    assert outcome.result.extraction == clean_extraction()
    assert [a.model for a in outcome.attempts] == [CLAUDE_HAIKU, CLAUDE_SONNET]
    # The cheap attempt is recorded unchanged.
    assert outcome.attempts[0].status == ExtractionStatus.needs_attention
    assert [i.code for i in outcome.attempts[0].issues] == [IssueCode.LOW_CONFIDENCE]
    # Haiku 0.0008 + Sonnet (3000 x $2 + 1000 x $10) = 0.016
    assert outcome.cost_usd == pytest.approx(0.0168)
    assert outcome.latency_ms == sum(a.latency_ms or 0 for a in outcome.attempts)


def test_cascade_flags_a_field_the_backup_left_null():
    # The cheap model reads every balance term, and they do not add up. The
    # backup leaves previous_balance null, which skips the balance check, so it
    # has no issues; "fewer issues wins" would hide the problem.
    cheap = FakeProvider(clean_extraction(previous_balance=ex("5000.00")))
    backup = FakeProvider(clean_extraction(previous_balance=null()))
    outcome = cascade(cheap, backup)
    first, second = outcome.attempts
    assert [(i.code, i.field) for i in first.issues] == [
        (IssueCode.BALANCE_MISMATCH, "amount_due")
    ]
    assert second.issues == []
    assert outcome.result.model == CLAUDE_SONNET
    assert outcome.result.extraction == clean_extraction(previous_balance=null())
    assert outcome.result.status == ExtractionStatus.needs_attention
    assert [(i.code, i.field) for i in outcome.result.issues] == [
        (IssueCode.MODELS_DISAGREE, "previous_balance")
    ]


def test_cascade_keeps_the_backups_issues_and_adds_disagreements():
    cheap = FakeProvider(clean_extraction(amount_due=ex("5000.00")))
    backup = FakeProvider(clean_extraction(amount_due=ex("5600.00", "5680.00")))
    outcome = cascade(cheap, backup)
    assert {(i.code, i.field) for i in outcome.result.issues} == {
        (IssueCode.BALANCE_MISMATCH, "amount_due"),  # the backup's own
        (IssueCode.EVIDENCE_MISMATCH, "amount_due"),
        (IssueCode.MODELS_DISAGREE, "amount_due"),
    }
    assert outcome.result.status == ExtractionStatus.needs_attention


def test_cascade_backup_saying_not_an_invoice_still_needs_attention():
    cheap = FakeProvider(clean_extraction(amount_due=ex("5000.00")))
    backup = FakeProvider(not_an_invoice())
    outcome = cascade(cheap, backup)
    assert outcome.attempts[1].status == ExtractionStatus.not_an_invoice
    assert outcome.result.status == ExtractionStatus.needs_attention
    disagreements = {i.field for i in outcome.result.issues}
    assert {"document_type", "amount_due", "vendor_name", "line_items"} <= (
        disagreements
    )
    assert {i.code for i in outcome.result.issues} == {IssueCode.MODELS_DISAGREE}


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

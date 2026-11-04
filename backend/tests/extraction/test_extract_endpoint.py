"""`POST /bills/extract`: the model is always mocked (no API calls in tests)."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from bill_factory import clean_extraction, not_an_invoice
from fastapi.testclient import TestClient

from backend.api import bill_extraction
from backend.app import app
from backend.auth import require_active_analyst
from backend.extraction import ExtractionResult, ExtractionStatus, Issue, IssueCode
from backend.extraction.extract import CascadeResult
from backend.extraction.providers import MissingApiKeyError

PDF_BYTES = b"%PDF-1.4\nsample"


@pytest.fixture
def client():
    app.dependency_overrides[require_active_analyst] = lambda: str(uuid4())
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def post_pdf(client: TestClient, data: bytes = PDF_BYTES):
    return client.post(
        "/bills/extract",
        files={"file": ("bill.pdf", data, "application/pdf")},
    )


def cascade(result: ExtractionResult) -> CascadeResult:
    return CascadeResult(result, (result,))


def test_requires_authentication():
    response = post_pdf(TestClient(app))

    assert response.status_code == 401


def test_returns_form_fields_for_a_readable_bill(client):
    result = ExtractionResult(
        status=ExtractionStatus.ready_for_review, extraction=clean_extraction()
    )

    with patch.object(
        bill_extraction, "extract_bill_cascade", return_value=cascade(result)
    ) as mock_extract:
        response = post_pdf(client)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready_for_review"
    assert body["fields"]["invoice_number"] == "BW-4471-2611"
    assert body["fields"]["vendor_name_raw"] == "Brightwater Utilities"
    assert body["fields"]["due_date"] == "2026-11-10"
    assert body["fields"]["amount"] == "5680.00"
    mock_extract.assert_called_once_with(PDF_BYTES, "application/pdf")


def test_passes_issues_through_for_review(client):
    issue = Issue(
        code=IssueCode.BALANCE_MISMATCH, field="amount_due", message="Does not add up."
    )
    result = ExtractionResult(
        status=ExtractionStatus.needs_attention,
        extraction=clean_extraction(),
        issues=[issue],
    )

    with patch.object(
        bill_extraction, "extract_bill_cascade", return_value=cascade(result)
    ):
        body = post_pdf(client).json()

    assert body["status"] == "needs_attention"
    assert body["issues"][0]["code"] == "BALANCE_MISMATCH"
    assert body["fields"] is not None


def test_returns_no_fields_for_a_document_that_is_not_a_bill(client):
    result = ExtractionResult(
        status=ExtractionStatus.not_an_invoice, extraction=not_an_invoice()
    )

    with patch.object(
        bill_extraction, "extract_bill_cascade", return_value=cascade(result)
    ):
        body = post_pdf(client).json()

    assert body["status"] == "not_an_invoice"
    assert body["fields"] is None


def test_reports_a_failed_read(client):
    result = ExtractionResult(
        status=ExtractionStatus.failed, failed_reason="PDF needs a password."
    )

    with patch.object(
        bill_extraction, "extract_bill_cascade", return_value=cascade(result)
    ):
        body = post_pdf(client).json()

    assert body == {
        "status": "failed",
        "fields": None,
        "issues": [],
        "failed_reason": "PDF needs a password.",
    }


def test_missing_api_key_is_a_503_not_a_bad_bill(client):
    with patch.object(
        bill_extraction,
        "extract_bill_cascade",
        side_effect=MissingApiKeyError("ANTHROPIC_API_KEY"),
    ):
        response = post_pdf(client)

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_without_a_key_the_real_extractor_reports_503(client):
    # conftest removes the API keys, so the real cascade raises before any call.
    from bill_factory import TEXT_LAYER, make_pdf

    response = post_pdf(client, make_pdf(TEXT_LAYER))

    assert response.status_code == 503


def test_rejects_files_over_the_size_limit(client):
    big = b"%PDF-" + b"0" * (bill_extraction.MAX_PDF_BYTES + 1)

    with patch.object(bill_extraction, "extract_bill_cascade") as mock_extract:
        response = post_pdf(client, big)

    assert response.status_code == 413
    mock_extract.assert_not_called()

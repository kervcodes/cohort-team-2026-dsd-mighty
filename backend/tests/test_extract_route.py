"""`POST /bills/extract` (DC-74). Who may call it is in test_route_permissions.py.

Every test but one injects a fake extractor through `get_bill_extractor`, so
no test calls a model; the one that runs the real cascade relies on conftest
having removed the API keys.
"""

import io
import logging
import threading
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from current_users import make_user
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from backend.api import bill_extraction
from backend.api.bill_extraction import (
    MAX_BODY_BYTES,
    MAX_FILE_BYTES,
    get_bill_extractor,
)
from backend.app import app
from backend.auth import get_current_user
from backend.extraction.providers import MissingApiKeyError
from backend.extraction.schema import (
    FIELD_NAMES,
    BillExtraction,
    Confidence,
    DocumentType,
    Extracted,
    ExtractionResult,
    ExtractionStatus,
    Issue,
    IssueCode,
    LineItem,
)

PDF = b"%PDF-1.7\n fake pdf bytes"
SECRET_TEXT = b"Account 88-2110-4471 SECRET"


def extraction() -> BillExtraction:
    # Plain values, validated into each field's own type, so this stays valid
    # when a field gets a narrower type than Extracted.
    fields = {
        name: {"value": None, "evidence": "", "confidence": Confidence.low}
        for name in FIELD_NAMES
    }
    fields["amount_due"] = {
        "value": "5680.00",
        "evidence": "Total amount due 5680.00",
        "confidence": "high",
    }
    fields["due_date"] = {
        "value": "2026-11-10",
        "evidence": "Due date 2026-11-10",
        "confidence": "medium",
    }
    line = LineItem(
        description=Extracted(value="Water", evidence="Water", confidence="high"),
        amount=Extracted(value="5000.00", evidence="5000.00", confidence="high"),
    )
    return BillExtraction.model_validate(
        {"document_type": DocumentType.invoice, "line_items": [line], **fields}
    )


def result() -> ExtractionResult:
    return ExtractionResult(
        status=ExtractionStatus.needs_attention,
        extraction=extraction(),
        issues=[
            Issue(
                code=IssueCode.MISSING_REQUIRED,
                field="vendor_name",
                message="vendor_name is missing",
            )
        ],
        model="claude-haiku-5-5",
        prompt_version="v1",
        file_sha256="ab" * 32,
        input_tokens=3000,
        output_tokens=1000,
        cost_usd=0.0008,
        latency_ms=1234,
    )


class FakeExtractor:
    """Stands in for the cascade; records what it was given."""

    def __init__(self, returns=None, raises: Exception | None = None) -> None:
        self.returns = returns or result()
        self.raises = raises
        self.calls: list[tuple[bytes, str]] = []

    def __call__(self, data: bytes, media_type: str) -> ExtractionResult:
        self.calls.append((data, media_type))
        if self.raises:
            raise self.raises
        return self.returns


@pytest.fixture
def fake() -> FakeExtractor:
    fake = FakeExtractor()
    app.dependency_overrides[get_bill_extractor] = lambda: fake
    return fake


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_current_user] = lambda: make_user()
    yield TestClient(app)


def upload(client: TestClient, data: bytes = PDF, media_type="application/pdf"):
    return client.post("/bills/extract", files={"file": ("bill.pdf", data, media_type)})


def test_returns_the_extraction_result_as_json(client, fake):
    response = upload(client)

    assert response.status_code == 200, response.text
    body = response.json()
    assert fake.calls == [(PDF, "application/pdf")]
    assert body["status"] == "needs_attention"
    assert body["failed_reason"] is None
    assert body["issues"] == [
        {
            "code": "MISSING_REQUIRED",
            "field": "vendor_name",
            "message": "vendor_name is missing",
        }
    ]
    # Amounts and dates stay the strings the model read; the form parses them.
    assert body["extraction"]["amount_due"] == {
        "value": "5680.00",
        "evidence": "Total amount due 5680.00",
        "confidence": "high",
    }
    assert body["extraction"]["due_date"]["value"] == "2026-11-10"
    assert body["extraction"]["vendor_name"] == {
        "value": None,
        "evidence": "",
        "confidence": "low",
    }
    assert body["extraction"]["line_items"][0]["amount"]["value"] == "5000.00"
    assert body["extraction"]["document_type"] == "invoice"
    assert body == ExtractionResult.model_validate(body).model_dump(mode="json")
    assert body == result().model_dump(mode="json")


@pytest.mark.parametrize("status", list(ExtractionStatus))
def test_every_status_passes_through(client, fake, status):
    fake.returns = ExtractionResult(
        status=status,
        failed_reason="the PDF could not be read"
        if status == ExtractionStatus.failed
        else None,
    )

    response = upload(client)

    assert response.status_code == 200
    assert response.json()["status"] == status.value
    assert response.json()["failed_reason"] == fake.returns.failed_reason


@pytest.mark.parametrize("media_type", ["image/png", "image/jpeg"])
def test_images_are_accepted(client, fake, media_type):
    data = b"\x89PNG\r\n\x1a\n fake"

    response = upload(client, data, media_type)

    assert response.status_code == 200
    # The declared type is passed on; the extractor decides from the bytes.
    assert fake.calls == [(data, media_type)]


@pytest.mark.parametrize(
    "media_type", ["text/plain", "image/gif", "application/octet-stream"]
)
def test_an_unsupported_declared_type_is_415(client, fake, media_type):
    response = upload(client, media_type=media_type)

    assert response.status_code == 415
    assert response.json()["detail"] == "Upload a PDF, PNG or JPEG file."
    assert fake.calls == []


def test_a_file_at_the_limit_is_read(client, fake):
    response = upload(client, b"%PDF-" + b"x" * (MAX_FILE_BYTES - 5))

    assert response.status_code == 200
    assert len(fake.calls[0][0]) == MAX_FILE_BYTES


def test_a_file_over_the_limit_is_413(client, fake):
    response = upload(client, b"%PDF-" + b"x" * (MAX_FILE_BYTES - 4))

    assert response.status_code == 413
    assert response.json()["detail"] == "The file must be 10 MB or smaller."
    assert fake.calls == []


def test_an_empty_file_is_400(client, fake):
    response = upload(client, b"")

    assert response.status_code == 400
    assert response.json()["detail"] == "The file is empty."
    assert fake.calls == []


def test_a_missing_file_field_is_422(client, fake):
    response = client.post("/bills/extract", data={"other": "x"})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "file"]
    assert fake.calls == []


def test_sign_in_is_required(fake):
    response = upload(TestClient(app))

    assert response.status_code == 401
    assert fake.calls == []


# The body cap. These stream the request through httpx's ASGI transport, which
# pulls each chunk only when the app asks for it, so they count how much of
# the body the app read.

BOUNDARY = "dc74boundary"
HEAD = (
    f"--{BOUNDARY}\r\n"
    'Content-Disposition: form-data; name="file"; filename="bill.pdf"\r\n'
    "Content-Type: application/pdf\r\n\r\n%PDF-"
).encode()
CHUNK = b"x" * (64 * 1024)


class StreamedBody:
    """A multipart body three times the cap, handed out a chunk at a time."""

    def __init__(self) -> None:
        self.sent = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for piece in [HEAD, *[CHUNK] * (3 * MAX_BODY_BYTES // len(CHUNK))]:
            self.sent += len(piece)
            yield piece
        yield f"\r\n--{BOUNDARY}--\r\n".encode()


async def post_streamed(body: StreamedBody, headers: dict[str, str]):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.post(
            "/bills/extract",
            content=body,
            headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}
            | headers,
        )


@pytest.mark.asyncio
async def test_a_body_without_content_length_is_cut_off_at_the_cap(client, fake):
    body = StreamedBody()

    response = await post_streamed(body, {})

    assert response.status_code == 413
    assert body.sent <= MAX_BODY_BYTES + len(CHUNK)
    assert fake.calls == []


@pytest.mark.asyncio
async def test_a_declared_content_length_over_the_cap_is_refused_unread(client, fake):
    body = StreamedBody()

    response = await post_streamed(body, {"Content-Length": str(MAX_BODY_BYTES + 1)})

    assert response.status_code == 413
    assert response.json()["detail"] == "The file must be 10 MB or smaller."
    assert body.sent == 0
    assert fake.calls == []


# Configuration errors and the deadline.


def blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_the_real_extractor_without_an_api_key_is_503(client, caplog):
    # No override: the real cascade runs, reaches the model call and finds no
    # ANTHROPIC_API_KEY (conftest removes it), so nothing is sent anywhere.
    with caplog.at_level(logging.ERROR, logger="backend.api.bill_extraction"):
        response = upload(client, blank_pdf())

    assert response.status_code == 503
    assert response.json()["detail"] == "Bill extraction is not configured."
    assert "ANTHROPIC_API_KEY is not set" in caplog.text


def test_an_unknown_model_is_not_masked_as_503(client, fake):
    # A programming error: it must surface as a crash, not as "not configured".
    fake.raises = ValueError("unknown model 'nope'")

    with pytest.raises(ValueError, match="unknown model"):
        upload(client)


def test_missing_api_key_from_the_extractor_is_503(client, fake):
    fake.raises = MissingApiKeyError("ANTHROPIC_API_KEY")

    response = upload(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "Bill extraction is not configured."


def test_an_extraction_past_the_deadline_is_504(client, fake, monkeypatch):
    monkeypatch.setattr(bill_extraction, "EXTRACTION_DEADLINE_SECONDS", 0.05)
    release = threading.Event()

    def slow(data: bytes, media_type: str) -> ExtractionResult:
        release.wait(timeout=5)  # a model call that hangs
        return result()

    app.dependency_overrides[get_bill_extractor] = lambda: slow
    try:
        response = upload(client)
    finally:
        release.set()  # let the abandoned worker thread finish

    assert response.status_code == 504
    assert response.json()["detail"] == (
        "Reading the bill took too long. Try again, or fill in the form."
    )


def test_the_request_log_has_metadata_and_no_file_content(client, fake, caplog):
    data = b"%PDF-1.7\n" + SECRET_TEXT
    user = make_user()
    app.dependency_overrides[get_current_user] = lambda: user

    with caplog.at_level(logging.INFO, logger="backend.api.bill_extraction"):
        upload(client, data)

    assert len(caplog.records) == 1
    line = caplog.records[0].getMessage()
    assert f"user_id={user.id}" in line
    assert f"bytes={len(data)}" in line
    assert "media_type=application/pdf" in line
    assert "status=needs_attention" in line
    assert "duration_ms=" in line
    assert "SECRET" not in caplog.text

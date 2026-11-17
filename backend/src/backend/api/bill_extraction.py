"""`POST /bills/extract`: read one uploaded bill with AI (DC-74).

Runs the DC-52 extractor on the file and returns its `ExtractionResult`. It
stores nothing; a person reviews the values in the form and creates the bill
with `POST /bills`. See docs/specs/DC-52-ai-extraction.md.

The declared content type must be PDF, PNG or JPEG (415 otherwise), but the
extractor decides what the file is from its first bytes and reports anything
else, and every other per-file rule (image size, page count, encryption), as
status `failed` with a reason.
"""

import logging
import time
from collections.abc import Callable, Coroutine
from typing import Any

import anyio
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.routing import APIRoute
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import Message, Receive

from backend.auth import CurrentUser, require_active
from backend.extraction.extract import (
    MAX_PDF_BYTES,
    MEDIA_TYPES,
    extract_bill_cascade,
)
from backend.extraction.providers import MissingApiKeyError
from backend.extraction.schema import ExtractionResult
from backend.services.bill_access import BILL_WRITERS

logger = logging.getLogger(__name__)

MAX_FILE_BYTES = MAX_PDF_BYTES  # the largest file the extractor takes (a PDF)
# Room for the multipart boundaries and part headers around the file.
MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024
TOO_LARGE = f"The file must be {MAX_FILE_BYTES // (1024 * 1024)} MB or smaller."

# The frontend shows "Reading invoice..." for 10-30 s on a typical bill, the
# cascade's two reads included. Each model call has a 60 s client timeout and
# 2 retries, so the extractor alone could run for minutes; 90 s lets a slow
# cascade or one retried call finish, and past that the person is better off
# typing the bill in.
EXTRACTION_DEADLINE_SECONDS = 90.0

BillExtractor = Callable[[bytes, str], ExtractionResult]


def read_with_cascade(data: bytes, media_type: str) -> ExtractionResult:
    """The production extractor: the DC-52 cascade, as the reviewer sees it.

    Synchronous and slow (one or two model calls). Each attempt logs its own
    model, tokens and cost.
    """
    return extract_bill_cascade(data, media_type).result


def get_bill_extractor() -> BillExtractor:
    """The extractor the route runs. Tests override this dependency with a
    fake, so no route test calls a model."""
    return read_with_cascade


def _capped(receive: Receive, limit: int) -> Receive:
    """`receive` that refuses the request once its body passes `limit` bytes,
    so an oversized upload is never read, or spooled to disk, in full."""
    received = 0

    async def capped_receive() -> Message:
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > limit:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
        return message

    return capped_receive


class CappedBodyRoute(APIRoute):
    """A route whose request body is capped at `MAX_BODY_BYTES`.

    FastAPI parses the whole multipart body (spooling files to disk) before
    the route or any dependency runs, so the cap has to sit here, under the
    body parser. A declared `Content-Length` over the cap is refused before
    any of the body is read; a body without one is cut off as it streams in.
    The 413 therefore comes before the sign-in check.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def capped_handler(request: Request) -> Response:
            length = request.headers.get("content-length", "")
            if length.isdigit() and int(length) > MAX_BODY_BYTES:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
            capped = Request(request.scope, _capped(request.receive, MAX_BODY_BYTES))
            return await handler(capped)

        return capped_handler


router = APIRouter(
    prefix="/bills",
    tags=["bill extraction"],
    route_class=CappedBodyRoute,
)


@router.post("/extract", response_model=ExtractionResult)
async def extract_bill_from_upload(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
    extractor: BillExtractor = Depends(get_bill_extractor),
) -> ExtractionResult:
    media_type = file.content_type
    if media_type is None or media_type not in MEDIA_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Upload a PDF, PNG or JPEG file.",
        )

    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.")

    started = time.perf_counter()
    result: ExtractionResult | None = None
    try:
        with anyio.move_on_after(EXTRACTION_DEADLINE_SECONDS):
            # Off the event loop: the extractor blocks on model calls. At the
            # deadline the route stops waiting, but a thread cannot be killed:
            # the abandoned call runs on (and may still be billed) until its
            # own client timeout, and its result is dropped.
            result = await anyio.to_thread.run_sync(
                extractor, data, media_type, abandon_on_cancel=True
            )
    except MissingApiKeyError as error:
        # The variable's name only, never a value.
        logger.error("bill extraction is not configured: %s is not set", error.var)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Bill extraction is not configured.",
        ) from error

    duration_ms = round((time.perf_counter() - started) * 1000)
    if result is None:
        logger.warning(
            "bill extraction deadline user_id=%s bytes=%s media_type=%s deadline_s=%s",
            user.id,
            len(data),
            media_type,
            EXTRACTION_DEADLINE_SECONDS,
        )
        raise HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT,
            "Reading the bill took too long. Try again, or fill in the form.",
        )

    logger.info(
        "bill extraction request user_id=%s bytes=%s media_type=%s status=%s "
        "duration_ms=%s",
        user.id,
        len(data),
        media_type,
        result.status.value,
        duration_ms,
    )
    return result

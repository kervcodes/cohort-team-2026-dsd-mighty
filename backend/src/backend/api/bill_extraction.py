"""`POST /bills/extract`: read an uploaded bill and return form pre-fill values.

Implements the endpoint described in docs/specs/DC-52-ai-extraction.md. It
stores nothing: the analyst reviews the values, then saves the draft.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.auth import require_active_analyst
from backend.extraction import ExtractionStatus, Issue, to_bill_create_dict
from backend.extraction.extract import MAX_PDF_BYTES, extract_bill_cascade
from backend.extraction.providers import MissingApiKeyError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bills", tags=["bills"])

# Two model calls (cheap read, then a backup read) at up to 60 s each, plus
# retries, can exceed this; past it the analyst fills the form by hand.
EXTRACTION_DEADLINE_SECONDS = 150


class ExtractResponse(BaseModel):
    status: ExtractionStatus
    # Form values under BillCreate field names; None when nothing usable was read.
    fields: dict[str, Any] | None = None
    issues: list[Issue] = []
    failed_reason: str | None = None


@router.post("/extract", response_model=ExtractResponse)
async def extract_bill_fields(
    file: UploadFile = File(...),
    _user_id: str = Depends(require_active_analyst),
) -> ExtractResponse:
    # Cap the read: never pull an arbitrarily large body into memory.
    data = await file.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File exceeds the 10 MB limit.",
        )

    try:
        cascade = await asyncio.wait_for(
            run_in_threadpool(extract_bill_cascade, data, file.content_type or ""),
            timeout=EXTRACTION_DEADLINE_SECONDS,
        )
    except MissingApiKeyError as exc:
        logger.error("Bill extraction is not configured: %s", exc.var)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Automatic extraction is not configured on the server.",
        ) from exc
    except TimeoutError:
        return ExtractResponse(
            status=ExtractionStatus.failed,
            failed_reason="Reading the bill took too long.",
        )

    result = cascade.result
    fields = (
        to_bill_create_dict(result.extraction, result.issues)
        if result.extraction is not None
        and result.status is not ExtractionStatus.not_an_invoice
        else None
    )

    return ExtractResponse(
        status=result.status,
        fields=fields,
        issues=result.issues,
        failed_reason=result.failed_reason,
    )

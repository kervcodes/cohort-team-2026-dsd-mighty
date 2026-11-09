import logging
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.auth import CurrentUser, require_active
from backend.services.bill_access import BILL_WRITERS
from backend.services.bill_repository import (
    attach_document,
    get_editable_draft,
)
from backend.services.bill_storage import (
    delete_pdf,
    generate_storage_path,
    upload_pdf,
    validate_pdf,
)
from backend.supabase_client import get_admin_supabase

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/bills",
    tags=["bill documents"],
)


class DocumentUploadResponse(BaseModel):
    bill_id: UUID
    document_path: str
    status: str


@router.post(
    "/{bill_id}/document",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_bill_document(
    bill_id: UUID,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> DocumentUploadResponse:
    client = get_admin_supabase()
    user_id = str(user.id)

    # 1. Verify bill ownership and draft status.
    try:
        bill = await run_in_threadpool(get_editable_draft, client, bill_id, user_id)
    except Exception as exc:
        logger.exception("Failed to load draft bill")
        raise HTTPException(
            status_code=503,
            detail="Unable to access bill records.",
        ) from exc

    if bill is None:
        raise HTTPException(
            status_code=404,
            detail="Editable draft not found.",
        )

    if bill["document_path"] is not None:
        raise HTTPException(
            status_code=409,
            detail="This bill already has a document.",
        )

    # 2. Validate file contents.
    contents = await validate_pdf(file)

    # 3. Generate a private storage path.
    storage_path = generate_storage_path(bill_id)

    # 4. Upload file.
    try:
        await run_in_threadpool(upload_pdf, client, storage_path, contents)
    except Exception as exc:
        logger.exception("Invoice Storage upload failed")
        raise HTTPException(
            status_code=503,
            detail="Unable to store the invoice PDF.",
        ) from exc

    # 5. Associate file with the bill.
    try:
        updated = await run_in_threadpool(
            attach_document,
            client,
            bill_id,
            user_id,
            storage_path,
        )
    except Exception as exc:
        logger.exception("Failed to associate invoice document")
        updated = None
        database_error = exc
    else:
        database_error = None

    if updated is None:
        # 6. Compensate for a failed database update.
        try:
            await run_in_threadpool(delete_pdf, client, storage_path)
        except Exception:
            logger.exception(
                "Orphaned invoice object requires cleanup: %s",
                storage_path,
            )

        if database_error is not None:
            raise HTTPException(
                status_code=503,
                detail="Unable to associate the uploaded document.",
            ) from database_error

        raise HTTPException(
            status_code=409,
            detail="Draft changed during upload. Please refresh.",
        )

    return DocumentUploadResponse(
        bill_id=bill_id,
        document_path=updated["document_path"],
        status=updated["status"],
    )

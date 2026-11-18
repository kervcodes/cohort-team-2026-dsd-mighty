from collections.abc import Iterator
from contextlib import contextmanager
from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from backend.auth import CurrentUser, require_active
from backend.schemas.bill import (
    BillCreate,
    BillDashboardRow,
    BillDocumentUrl,
    BillDraftCreate,
    BillDraftDetail,
    BillDraftRead,
    BillRead,
    BillStatus,
)
from backend.services.bill_access import (
    BILL_READERS,
    BILL_WRITERS,
    BillScope,
    default_scope,
)
from backend.services.bill_repository import (
    DuplicateInvoice,
    get_editable_draft,
    get_readable_bill,
    list_dashboard_bills,
    list_readable_bills,
    resubmit_bill_with_approval,
    save_bill,
    submit_bill_with_approval,
    submit_draft_with_approval,
    update_draft,
)
from backend.services.bill_storage import create_pdf_signed_url
from backend.services.vendor_account_matching import UnusableVendorAccount
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/bills",
    tags=["bills"],
)

DUPLICATE_INVOICE_DETAIL = (
    "This invoice number is already in the system for this vendor account."
)


@contextmanager
def bill_write_errors() -> Iterator[None]:
    """The HTTP answers every bill write gives for a bad vendor account pick
    (422) and for an invoice number the account already has (409). Used as a
    decorator on each write route."""
    try:
        yield
    except UnusableVendorAccount as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except DuplicateInvoice as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DUPLICATE_INVOICE_DETAIL,
        ) from error


def _raise_bill_rpc_error(exc: APIError, not_found_detail: str) -> NoReturn:
    if exc.code in {"P0002", "42501"}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=not_found_detail,
        ) from exc

    if exc.code == "P0001":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.message,
        ) from exc

    raise exc


# Submit a brand-new invoice and create its pending approval.
@router.post(
    "",
    response_model=BillRead,
    status_code=status.HTTP_201_CREATED,
)
@bill_write_errors()
def create_bill(
    bill: BillCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillRead:
    return submit_bill_with_approval(
        client=get_admin_supabase(),
        fields=bill,
        user_id=user.id,
    )


# Resubmit a previously rejected invoice.
# The existing bill and rejected approval history are preserved.
@router.post(
    "/{bill_id}/resubmit",
    response_model=BillRead,
)
@bill_write_errors()
def resubmit_bill(
    bill_id: UUID,
    bill: BillCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillRead:
    try:
        return resubmit_bill_with_approval(
            client=get_admin_supabase(),
            bill_id=bill_id,
            fields=bill,
            user_id=user.id,
        )
    except APIError as exc:
        _raise_bill_rpc_error(exc, "Bill not found.")


@router.get("", response_model=list[BillRead])
def list_bills(
    scope: BillScope | None = None,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> list[BillRead]:
    return list_readable_bills(
        client=get_admin_supabase(),
        user_id=user.id,
        scope=scope or default_scope(user.role),
    )


@router.get("/dashboard", response_model=list[BillDashboardRow])
def get_dashboard_bills(
    scope: BillScope | None = None,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> list[dict]:
    return list_dashboard_bills(
        client=get_admin_supabase(),
        user_id=user.id,
        scope=scope or default_scope(user.role),
    )


@router.get(
    "/{bill_id}/document",
    response_model=BillDocumentUrl,
)
def get_bill_document(
    bill_id: UUID,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> BillDocumentUrl:
    client = get_admin_supabase()

    bill = get_readable_bill(
        client=client,
        bill_id=bill_id,
        user_id=user.id,
    )

    if bill is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill not found.",
        )

    bill_data = BillRead.model_validate(bill)
    document_path = bill_data.document_path

    if not document_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice document not found.",
        )

    try:
        signed_url = create_pdf_signed_url(
            client=client,
            storage_path=document_path,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve invoice document.",
        ) from exc

    return BillDocumentUrl(document_url=signed_url)


# Save a new draft without creating an approval record.
@router.post(
    "/drafts",
    response_model=BillDraftRead,
    status_code=status.HTTP_201_CREATED,
)
@bill_write_errors()
def save_new_draft(
    draft: BillDraftCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillDraftRead:
    saved = save_bill(
        client=get_admin_supabase(),
        fields=draft,
        user_id=user.id,
        status=BillStatus.draft,
    )

    return BillDraftRead(
        bill_id=saved.id,
        status=saved.status,
        document_path=saved.document_path,
    )


@router.patch(
    "/{bill_id}/draft",
    response_model=BillDraftRead,
)
@bill_write_errors()
def update_existing_draft(
    bill_id: UUID,
    draft: BillDraftCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillDraftRead:
    updated = update_draft(
        client=get_admin_supabase(),
        bill_id=bill_id,
        user_id=str(user.id),
        draft=draft,
    )

    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Editable draft not found.",
        )

    return BillDraftRead.model_validate(updated)


# Submit an existing draft, preserving its bill ID and attached PDF.
# The repository function must also create the pending approval record
# in the same database transaction.
@router.post(
    "/{bill_id}/submit",
    response_model=BillRead,
)
@bill_write_errors()
def submit_existing_draft(
    bill_id: UUID,
    bill: BillCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillRead:
    try:
        return submit_draft_with_approval(
            client=get_admin_supabase(),
            bill_id=bill_id,
            fields=bill,
            user_id=user.id,
        )
    except APIError as exc:
        _raise_bill_rpc_error(exc, "Editable draft not found.")


@router.get(
    "/{bill_id}/draft",
    response_model=BillDraftDetail,
)
def get_draft(
    bill_id: UUID,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillDraftDetail:
    draft = get_editable_draft(
        client=get_admin_supabase(),
        bill_id=bill_id,
        user_id=str(user.id),
    )

    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Editable draft not found.",
        )

    return BillDraftDetail.model_validate(draft)


@router.get("/{bill_id}", response_model=BillRead)
def get_bill(
    bill_id: UUID,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> BillRead:
    bill = get_readable_bill(
        client=get_admin_supabase(),
        bill_id=bill_id,
        user_id=user.id,
    )

    if bill is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill not found.",
        )

    return bill

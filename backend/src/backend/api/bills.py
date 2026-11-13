from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

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
    get_editable_draft,
    get_readable_bill,
    list_dashboard_bills,
    list_readable_bills,
    save_bill,
    submit_bill_with_approval,
    update_draft,
)
from backend.services.bill_storage import create_pdf_signed_url
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/bills",
    tags=["bills"],
)


@router.post(
    "",
    response_model=BillRead,
    status_code=status.HTTP_201_CREATED,
)
def create_bill(
    bill: BillCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillRead:
    return submit_bill_with_approval(
        client=get_admin_supabase(),
        fields=bill,
        user_id=user.id,
    )


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


@router.post(
    "/drafts",
    response_model=BillDraftRead,
    status_code=status.HTTP_201_CREATED,
)
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

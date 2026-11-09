from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import CurrentUser, require_active
from backend.schemas.bill import (
    BillCreate,
    BillDashboardRow,
    BillDraftCreate,
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
    get_readable_bill,
    list_dashboard_bills,
    list_readable_bills,
    save_bill,
    update_draft,
)
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/bills",
    tags=["bills"],
)


@router.post("", response_model=BillRead, status_code=status.HTTP_201_CREATED)
def create_bill(
    bill: BillCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillRead:
    return save_bill(
        client=get_admin_supabase(),
        fields=bill,
        user_id=user.id,
        status=BillStatus.pending_approval,
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

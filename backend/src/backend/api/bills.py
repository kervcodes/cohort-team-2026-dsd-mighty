from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import BILL_READERS, BILL_WRITERS, CurrentUser, require_active
from backend.schemas.bill import (
    BillCreate,
    BillDashboardRow,
    BillDraftCreate,
    BillDraftRead,
    BillRead,
    BillStatus,
)
from backend.schemas.user import UserSummary
from backend.services.bill_repository import (
    create_draft,
    list_user_bills,
    update_draft,
)
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/bills",
    tags=["bills"],
)

_bills: list[BillRead] = []


@router.post("", response_model=BillRead, status_code=status.HTTP_201_CREATED)
def create_bill(bill: BillCreate) -> BillRead:
    new_bill = BillRead(
        **bill.model_dump(),
        id=uuid4(),
        submitted_by=UserSummary(
            id=uuid4(),
            full_name="Demo User",
        ),
        status=BillStatus.draft,
        created_at=datetime.now(UTC),
    )

    _bills.append(new_bill)
    return new_bill


@router.get("", response_model=list[BillRead])
def list_bills() -> list[BillRead]:
    return _bills


@router.get("/dashboard", response_model=list[BillDashboardRow])
def get_dashboard_bills(
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> list[dict]:
    # Own bills only, for every role, until all-bills for approvers and admins.
    return list_user_bills(
        client=get_admin_supabase(),
        user_id=str(user.id),
    )


@router.get("/{bill_id}", response_model=BillRead)
def get_bill(bill_id: UUID) -> BillRead:
    for bill in _bills:
        if bill.id == bill_id:
            return bill
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Bill not found.",
    )


@router.post(
    "/drafts",
    response_model=BillDraftRead,
    status_code=status.HTTP_201_CREATED,
)
def save_new_draft(
    draft: BillDraftCreate,
    user: CurrentUser = Depends(require_active(*BILL_WRITERS)),
) -> BillDraftRead:
    saved = create_draft(
        client=get_admin_supabase(),
        draft=draft,
        user_id=str(user.id),
    )

    return BillDraftRead.model_validate(saved)


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

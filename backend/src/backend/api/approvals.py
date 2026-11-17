from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError

from backend.auth import CurrentUser, require_active
from backend.schemas.approval import (
    ApprovalDecision,
    ApprovalDecisionType,
    ApprovalRead,
)
from backend.schemas.common import ApprovalStatus
from backend.schemas.user import UserRole
from backend.services.approval_repository import (
    decide_approval,
    list_approvals,
)
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/approvals",
    tags=["approvals"],
)


@router.get("", response_model=list[ApprovalRead])
def get_approvals(
    status_filter: ApprovalStatus = Query(
        default="pending",
        alias="status",
    ),
    bill_id: UUID | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(require_active(UserRole.approver, UserRole.admin)),
) -> list[ApprovalRead]:
    return list_approvals(
        client=get_admin_supabase(),
        status_filter=status_filter,
        bill_id=bill_id,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/{approval_id}/decision",
    response_model=ApprovalRead,
)
def make_approval_decision(
    approval_id: UUID,
    decision: ApprovalDecision,
    user: CurrentUser = Depends(require_active(UserRole.approver, UserRole.admin)),
) -> ApprovalRead:
    if decision.decision == ApprovalDecisionType.REJECT and not (
        decision.comments and decision.comments.strip()
    ):
        raise HTTPException(
            status_code=422,
            detail="A comment is required when rejecting an approval.",
        )
    try:
        return decide_approval(
            client=get_admin_supabase(),
            approval_id=approval_id,
            reviewer_id=user.id,
            decision=decision.decision,
            comments=decision.comments,
        )

    except APIError as exc:
        error_code = getattr(exc, "code", None)

        if error_code == "P0002":
            raise HTTPException(
                status_code=404,
                detail="Approval or associated bill not found.",
            ) from exc

        if error_code == "P0001":
            raise HTTPException(
                status_code=409,
                detail=str(exc.message),
            ) from exc

        if error_code == "42501":
            raise HTTPException(
                status_code=403,
                detail=str(exc.message),
            ) from exc

        if error_code == "22023":
            raise HTTPException(
                status_code=422,
                detail=str(exc.message),
            ) from exc

        raise HTTPException(
            status_code=500,
            detail="Unable to process the approval decision.",
        ) from exc

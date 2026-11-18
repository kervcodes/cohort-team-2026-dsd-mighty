"""The audit log for admins (DC-89): every recorded change, and one bill's
history. Only active admins may read the log; it is served as stored, with
sensitive values masked."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import AUDIT_READERS, CurrentUser, require_active
from backend.schemas.audit_log import AuditChangePage, AuditTable, BillHistory
from backend.services.audit_log_repository import ChangeFilters, list_changes
from backend.services.bill_history import load_bill_history
from backend.supabase_client import get_admin_supabase

router = APIRouter(tags=["audit"])

# The log's id is a Postgres bigint.
MAX_BIGINT = 2**63 - 1


@router.get("/audit/changes", response_model=AuditChangePage)
def read_changes(
    _user: CurrentUser = Depends(require_active(*AUDIT_READERS)),
    table: AuditTable | None = None,
    actor_id: UUID | None = None,
    bill_id: UUID | None = None,
    from_day: Annotated[date | None, Query(alias="from")] = None,
    to_day: Annotated[date | None, Query(alias="to")] = None,
    before_id: Annotated[int | None, Query(ge=1, le=MAX_BIGINT)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AuditChangePage:
    """Recorded changes, newest first, one page at a time."""
    filters = ChangeFilters(
        table=table,
        actor_id=actor_id,
        bill_id=bill_id,
        from_day=from_day,
        to_day=to_day,
        before_id=before_id,
        limit=limit,
    )
    return list_changes(get_admin_supabase(), filters)


@router.get("/bills/{bill_id}/history", response_model=BillHistory)
def read_bill_history(
    bill_id: UUID,
    _user: CurrentUser = Depends(require_active(*AUDIT_READERS)),
) -> BillHistory:
    """The bill's events, oldest first."""
    history = load_bill_history(get_admin_supabase(), bill_id)
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found."
        )
    return history

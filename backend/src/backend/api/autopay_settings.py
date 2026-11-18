"""The autopay setting (DC-86): approved bills up to the limit are paid by
the payment agent without anyone pressing Pay with AI.

Approvers and admins read it; only admins change it. Turning it on needs a
limit above 0, which the database also enforces.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import AUTOPAY_READERS, AUTOPAY_WRITERS, CurrentUser, require_active
from backend.schemas.autopay import AutopaySettingsRead, AutopaySettingsUpdate
from backend.services.autopay import get_autopay_settings, update_autopay_settings
from backend.supabase_client import get_admin_supabase

router = APIRouter(prefix="/autopay-settings", tags=["autopay"])


@router.get("", response_model=AutopaySettingsRead)
def read_autopay_settings(
    user: CurrentUser = Depends(require_active(*AUTOPAY_READERS)),
) -> AutopaySettingsRead:
    return get_autopay_settings(get_admin_supabase())


@router.put("", response_model=AutopaySettingsRead)
def change_autopay_settings(
    change: AutopaySettingsUpdate,
    user: CurrentUser = Depends(require_active(*AUTOPAY_WRITERS)),
) -> AutopaySettingsRead:
    if change.enabled and change.limit_amount is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Set a limit above $0 to turn on autopay.",
        )
    return update_autopay_settings(get_admin_supabase(), change, updated_by=user.id)

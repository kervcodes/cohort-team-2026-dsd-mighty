from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import PAYMENT_WRITERS, CurrentUser, require_active
from backend.schemas.bill import BillStatus
from backend.schemas.payment import PaymentCreate, PaymentRead
from backend.services.bill_access import BILL_READERS
from backend.services.bill_repository import get_readable_bill
from backend.services.payment_repository import (
    AmountMismatch,
    BillNotApproved,
    BillNotFound,
    list_bill_payments,
    record_payment,
)
from backend.supabase_client import get_admin_supabase
from supabase import Client

router = APIRouter(
    prefix="/bills/{bill_id}/payments",
    tags=["payments"],
)


def _bill_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Bill not found.",
    )


def _require_readable_bill(client: Client, bill_id: UUID, user: CurrentUser) -> None:
    # The bill read rule decides, so a bill the caller can't see (another
    # user's draft) is a 404 here too, never a 409 that says it exists.
    if get_readable_bill(client=client, bill_id=bill_id, user_id=user.id) is None:
        raise _bill_not_found()


def _not_approved_detail(bill_status: BillStatus | None) -> str:
    if bill_status is None:
        return "This bill can't be paid in its current state."
    if bill_status is BillStatus.paid:
        return "This bill has already been paid."
    label = bill_status.replace("_", " ")
    return f"Only approved bills can be paid. This bill is {label}."


def _amount_mismatch_detail(bill_amount: Decimal | None) -> str:
    if bill_amount is None:
        return "This bill has no amount, so it can't be marked paid."
    return f"A completed payment must be for the full bill amount ({bill_amount:.2f})."


@router.post("", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
def record_bill_payment(
    bill_id: UUID,
    payment: PaymentCreate,
    user: CurrentUser = Depends(require_active(*PAYMENT_WRITERS)),
) -> PaymentRead:
    """Record a payment attempt. A completed payment marks the bill paid; a
    failed one leaves it approved."""
    client = get_admin_supabase()
    _require_readable_bill(client, bill_id, user)

    try:
        return record_payment(
            client=client,
            bill_id=bill_id,
            payment=payment,
            recorded_by=user.id,
        )
    except BillNotFound as exc:
        raise _bill_not_found() from exc
    except BillNotApproved as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_not_approved_detail(exc.status),
        ) from exc
    except AmountMismatch as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=_amount_mismatch_detail(exc.bill_amount),
        ) from exc


@router.get("", response_model=list[PaymentRead])
def list_payments(
    bill_id: UUID,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> list[PaymentRead]:
    """The bill's payment attempts, newest first."""
    client = get_admin_supabase()
    _require_readable_bill(client, bill_id, user)

    return list_bill_payments(client=client, bill_id=bill_id)

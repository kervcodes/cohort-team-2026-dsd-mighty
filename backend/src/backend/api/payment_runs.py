"""Payment runs: "Pay with AI" on an approved bill (DC-84).

`POST` only queues the run; the payment agent worker
(`python -m backend.payment_agent.worker`) claims it and pays the bill on the
vendor's portal. Who may read a run follows the bill read rule: a run is
visible exactly when its bill is.
"""

from typing import assert_never
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.api.payments import not_approved_detail
from backend.auth import PAYMENT_WRITERS, CurrentUser, require_active
from backend.schemas.bill import BillRead
from backend.schemas.payment_run import PaymentRunRead, PaymentRunTrigger
from backend.services.bill_access import BILL_READERS
from backend.services.bill_repository import get_readable_bill
from backend.services.payment_run_queue import (
    RunNotQueued,
    RunRefusal,
    queue_payment_run,
)
from backend.services.payment_run_repository import get_run, list_bill_runs
from backend.supabase_client import get_admin_supabase
from supabase import Client

router = APIRouter(tags=["payment runs"])


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what}.")


def _readable_bill(client: Client, bill_id: UUID, user: CurrentUser) -> BillRead:
    # The bill read rule decides, so a bill the caller can't see (another
    # user's draft) is a 404 here too, never a 409 that says it exists.
    bill = get_readable_bill(client=client, bill_id=bill_id, user_id=user.id)
    if bill is None:
        raise _not_found("Bill not found")
    return bill


def _refusal_error(refusal: RunRefusal, bill: BillRead) -> HTTPException:
    """409 when the bill's state says no, 422 when its vendor account needs
    work first."""
    conflict, unprocessable = (
        status.HTTP_409_CONFLICT,
        status.HTTP_422_UNPROCESSABLE_CONTENT,
    )
    match refusal:
        case RunRefusal.not_approved:
            return HTTPException(conflict, not_approved_detail(bill.status))
        case RunRefusal.run_active:
            return HTTPException(
                conflict, "A payment run is already in progress for this bill."
            )
        case RunRefusal.no_vendor_account:
            return HTTPException(
                unprocessable, "This bill isn't matched to a vendor account."
            )
        case RunRefusal.account_inactive:
            return HTTPException(
                unprocessable, "This bill's vendor account is inactive."
            )
        case RunRefusal.no_portal_login:
            return HTTPException(
                unprocessable,
                "The vendor account has no portal login. "
                "Add the portal URL, email and password first.",
            )
        case _:
            assert_never(refusal)


@router.post(
    "/bills/{bill_id}/payment-runs",
    response_model=PaymentRunRead,
    status_code=status.HTTP_201_CREATED,
)
def start_payment_run(
    bill_id: UUID,
    user: CurrentUser = Depends(require_active(*PAYMENT_WRITERS)),
) -> PaymentRunRead:
    """Queue a payment run for an approved bill."""
    client = get_admin_supabase()
    bill = _readable_bill(client, bill_id, user)

    try:
        return queue_payment_run(
            client,
            bill,
            started_by=user.id,
            trigger=PaymentRunTrigger.manual,
            first_step=f"Queued by {user.full_name}.",
        )
    except RunNotQueued as exc:
        raise _refusal_error(exc.refusal, bill) from exc


@router.get("/bills/{bill_id}/payment-runs", response_model=list[PaymentRunRead])
def list_payment_runs(
    bill_id: UUID,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> list[PaymentRunRead]:
    """The bill's payment runs, newest first."""
    client = get_admin_supabase()
    _readable_bill(client, bill_id, user)

    return list_bill_runs(client, bill_id)


@router.get("/payment-runs/{run_id}", response_model=PaymentRunRead)
def read_payment_run(
    run_id: UUID,
    user: CurrentUser = Depends(require_active(*BILL_READERS)),
) -> PaymentRunRead:
    client = get_admin_supabase()
    run = get_run(client, run_id)
    # A run of a bill the caller can't read is as missing as no run.
    if run is None or get_readable_bill(client, run.bill_id, user.id) is None:
        raise _not_found("Payment run not found")
    return run

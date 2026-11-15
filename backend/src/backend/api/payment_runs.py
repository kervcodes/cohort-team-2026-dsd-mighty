"""Payment runs: "Pay with AI" on an approved bill (DC-84).

`POST` only queues the run; the payment agent worker
(`python -m backend.payment_agent.worker`) claims it and pays the bill on the
vendor's portal. Who may read a run follows the bill read rule: a run is
visible exactly when its bill is.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.api.payments import not_approved_detail
from backend.auth import PAYMENT_WRITERS, CurrentUser, require_active
from backend.schemas.bill import BillRead, BillStatus
from backend.schemas.payment_run import PaymentRunRead
from backend.services.bill_access import BILL_READERS
from backend.services.bill_repository import get_readable_bill
from backend.services.payment_run_repository import (
    RunAlreadyActive,
    get_run,
    list_bill_runs,
    new_step,
    queue_run,
)
from backend.services.vendor_account_repository import get_account
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


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail
    )


def _require_portal_login(client: Client, bill: BillRead) -> None:
    """The agent needs the matched, active account's portal URL, email and
    password. Only whether a password is set is read here, never the password."""
    if bill.vendor_account_id is None:
        raise _unprocessable("This bill isn't matched to a vendor account.")
    account = get_account(client, bill.vendor_account_id)
    if account is None:
        raise _unprocessable("This bill isn't matched to a vendor account.")
    if account["status"] != "active":
        raise _unprocessable("This bill's vendor account is inactive.")
    if not (
        account["portal_url"]
        and account["portal_login_email"]
        and account["portal_password_set"]
    ):
        raise _unprocessable(
            "The vendor account has no portal login. "
            "Add the portal URL, email and password first."
        )


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

    if bill.status is not BillStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=not_approved_detail(bill.status),
        )
    _require_portal_login(client, bill)

    try:
        return queue_run(
            client,
            bill_id=bill_id,
            started_by=user.id,
            first_step=new_step("queued", f"Queued by {user.full_name}."),
        )
    except RunAlreadyActive as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A payment run is already in progress for this bill.",
        ) from exc


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

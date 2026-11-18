"""Queue a payment run for a bill: the one path for Pay with AI
(`POST /bills/{bill_id}/payment-runs`) and for autopay after an approval.

Every check the payment agent needs before it can pay is here, so neither
caller can queue a run the other would refuse. Refusals carry a reason, not a
message: the route turns them into HTTP errors, autopay into log lines.
"""

from enum import StrEnum
from uuid import UUID

from backend.schemas.bill import BillRead, BillStatus
from backend.schemas.payment_run import PaymentRunRead, PaymentRunTrigger
from backend.services.payment_run_repository import (
    RunAlreadyActive,
    new_step,
    queue_run,
)
from backend.services.vendor_account_repository import get_account
from supabase import Client


class RunRefusal(StrEnum):
    """Why a bill can't get a payment run now."""

    not_approved = "not_approved"
    no_vendor_account = "no_vendor_account"
    account_inactive = "account_inactive"
    no_portal_login = "no_portal_login"
    run_active = "run_active"


class RunNotQueued(Exception):
    def __init__(self, refusal: RunRefusal) -> None:
        super().__init__(refusal.value)
        self.refusal = refusal


def _refuse_unless_payable(client: Client, bill: BillRead) -> None:
    """The bill is approved and matched to an active vendor account with a
    portal URL, login email and password. Only whether a password is set is
    read here, never the password."""
    if bill.status is not BillStatus.approved:
        raise RunNotQueued(RunRefusal.not_approved)
    account = (
        get_account(client, bill.vendor_account_id)
        if bill.vendor_account_id is not None
        else None
    )
    if account is None:
        raise RunNotQueued(RunRefusal.no_vendor_account)
    if account["status"] != "active":
        raise RunNotQueued(RunRefusal.account_inactive)
    if not (
        account["portal_url"]
        and account["portal_login_email"]
        and account["portal_password_set"]
    ):
        raise RunNotQueued(RunRefusal.no_portal_login)


def queue_payment_run(
    client: Client,
    bill: BillRead,
    *,
    started_by: UUID,
    trigger: PaymentRunTrigger,
    first_step: str,
) -> PaymentRunRead:
    """Queue a run for `bill`, or raise RunNotQueued saying why not. The
    payment agent worker picks the run up; `first_step` is its first line."""
    _refuse_unless_payable(client, bill)
    try:
        return queue_run(
            client,
            bill_id=bill.id,
            started_by=started_by,
            trigger=trigger,
            first_step=new_step("queued", first_step),
        )
    except RunAlreadyActive as exc:
        raise RunNotQueued(RunRefusal.run_active) from exc

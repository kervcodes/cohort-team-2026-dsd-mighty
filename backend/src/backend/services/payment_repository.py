"""Payments against bills. Recording one goes through the `record_payment`
Postgres function (migration 20261115120000_record_payment), which locks the
bill, checks it, inserts the payment and marks the bill paid in one
transaction."""

from decimal import Decimal
from typing import Any
from uuid import UUID

from postgrest.exceptions import APIError

from backend.schemas.bill import BillStatus
from backend.schemas.payment import PaymentCreate, PaymentRead
from supabase import Client

PAYMENT_COLUMNS = (
    "payment_id,bill_id,amount,payment_method,payment_status,paid_on,"
    "provider_reference,failure_reason,attempt_number,recorded_by,created_at"
)


class BillNotFound(Exception):
    pass


class BillNotApproved(Exception):
    def __init__(self, status: BillStatus) -> None:
        super().__init__(status)
        self.status = status


class AmountMismatch(Exception):
    def __init__(self, bill_amount: Decimal) -> None:
        super().__init__(bill_amount)
        self.bill_amount = bill_amount


def _to_payment(row: dict[str, Any]) -> PaymentRead:
    return PaymentRead.model_validate(
        {
            **row,
            "id": row["payment_id"],
            "reference": row["provider_reference"],
        }
    )


def record_payment(
    client: Client,
    bill_id: UUID,
    payment: PaymentCreate,
    recorded_by: UUID,
) -> PaymentRead:
    """Record `payment` against `bill_id` as entered by `recorded_by`.
    Raises BillNotFound, BillNotApproved or AmountMismatch when the function
    refuses it."""
    fields = payment.model_dump(mode="json")
    params = {
        "p_bill_id": str(bill_id),
        "p_amount": fields["amount"],
        "p_payment_method": fields["payment_method"],
        "p_paid_on": fields["paid_on"],
        "p_provider_reference": fields["reference"],
        "p_payment_status": fields["outcome"],
        "p_failure_reason": fields["failure_reason"],
        "p_recorded_by": str(recorded_by),
    }

    try:
        response = client.rpc("record_payment", params).execute()
    except APIError as exc:
        # The function's custom SQLSTATEs; DETAIL carries the bill's value.
        if exc.code == "PT404":
            raise BillNotFound from exc
        if exc.code == "PT409":
            raise BillNotApproved(BillStatus(exc.details)) from exc
        if exc.code == "PT422":
            raise AmountMismatch(Decimal(str(exc.details))) from exc
        raise

    row = response.data
    if not isinstance(row, dict):
        kind = type(row).__name__
        raise RuntimeError(f"Expected one payment row from record_payment, got {kind}")

    return _to_payment(row)


def list_bill_payments(client: Client, bill_id: UUID) -> list[PaymentRead]:
    """Every payment attempt for the bill, newest first. Attempt numbers are
    given out in order under the bill's row lock, so they order by time."""
    response = (
        client.table("payments")
        .select(PAYMENT_COLUMNS)
        .eq("bill_id", str(bill_id))
        .order("attempt_number", desc=True)
        .execute()
    )

    return [_to_payment(row) for row in response.data or []]

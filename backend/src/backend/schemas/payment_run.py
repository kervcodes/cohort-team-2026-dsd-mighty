from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class PaymentRunStatus(StrEnum):
    """Lifecycle of a payment run (migration 20261117110000_payment_runs)."""

    queued = "queued"
    running = "running"
    paid = "paid"
    flagged = "flagged"
    failed = "failed"


ACTIVE_RUN_STATUSES = (PaymentRunStatus.queued, PaymentRunStatus.running)


class PaymentRunStep(BaseModel):
    """One line of what the agent did. Never holds a secret."""

    at: datetime
    step: str
    detail: str


class PaymentRunReceipt(BaseModel):
    """What the vendor portal's receipt said."""

    confirmation_number: str
    bill_number: str
    amount: Decimal
    paid_on: date
    outcome: Literal["successful", "declined"]
    portal: str


class PaymentRunRead(BaseModel):
    id: UUID
    bill_id: UUID
    started_by: UUID
    status: PaymentRunStatus
    steps: list[PaymentRunStep]
    flag_reason: str | None = None
    receipt: PaymentRunReceipt | None = None
    payment_id: UUID | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.schemas.bill import Money
from backend.schemas.common import PaymentMethod

CENT = Decimal("0.01")


class PaymentStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class PaymentOutcome(StrEnum):
    """What a person records: the payment went through, or it failed."""

    COMPLETED = "completed"
    FAILED = "failed"


class PaymentCreate(BaseModel):
    """`POST /bills/{bill_id}/payments`: one payment attempt for the bill."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    amount: Money = Field(gt=0)
    payment_method: PaymentMethod
    paid_on: date
    reference: str | None = Field(default=None, min_length=1, max_length=200)
    outcome: PaymentOutcome
    failure_reason: str | None = Field(default=None, min_length=1, max_length=1000)

    @field_validator("paid_on")
    @classmethod
    def not_in_the_future(cls, paid_on: date) -> date:
        # The latest time zone is UTC+14, so somewhere it is already tomorrow
        # in UTC terms; anything later is the future everywhere.
        if paid_on > datetime.now(UTC).date() + timedelta(days=1):
            raise ValueError("A payment date can't be in the future.")
        return paid_on

    @model_validator(mode="after")
    def failure_reason_only_when_failed(self) -> Self:
        if self.outcome is PaymentOutcome.FAILED and self.failure_reason is None:
            raise ValueError("A failed payment needs a failure reason.")
        if self.outcome is PaymentOutcome.COMPLETED and self.failure_reason is not None:
            raise ValueError("A completed payment can't have a failure reason.")
        return self


class PaymentRead(BaseModel):
    id: UUID
    bill_id: UUID
    amount: Decimal
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    paid_on: date | None = None
    reference: str | None = None
    failure_reason: str | None = None
    attempt_number: int
    recorded_by: UUID
    created_at: datetime

    @field_validator("amount")
    @classmethod
    def in_cents(cls, amount: Decimal) -> Decimal:
        # PostgREST sends numeric(12,2) as a JSON number, so 75.00 arrives as 75.0.
        return amount.quantize(CENT)

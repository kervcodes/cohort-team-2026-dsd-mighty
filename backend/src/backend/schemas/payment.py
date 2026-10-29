from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.common import PaymentMethod

class PaymentStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class PaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payment_method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


class PaymentResultUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payment_status: PaymentStatus
    provider_reference: str | None = Field(default=None, max_length=200)
    failure_reason: str | None = Field(default=None, max_length=1000)
    completed_at: datetime | None = None


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    bill_id: UUID
    payment_method: PaymentMethod
    amount: Decimal
    payment_status: PaymentStatus
    attempted_at: datetime
    completed_at: datetime | None = None
    provider_reference: str | None = None
    failure_reason: str | None = None

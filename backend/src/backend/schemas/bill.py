from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.user import UserSummary

Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]


class BillStatus(StrEnum):
    draft = "draft"
    pending_approval = "pending_approval"
    approved = "approved"
    rejected = "rejected"
    paid = "paid"
    failed = "failed"
    exception = "exception"


class BillBase(BaseModel):
    account_number_raw: str = Field(min_length=1, max_length=100)
    vendor_name_raw: str | None = Field(default=None, max_length=200)
    invoice_number: str = Field(min_length=1, max_length=100)
    invoice_date: date
    due_date: date
    amount: Money = Field(gt=0)
    prev_payments: Money | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=2000)
    processing_notes: str | None = Field(default=None, max_length=2000)


class BillCreate(BillBase):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BillUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_number_raw: str | None = Field(default=None, min_length=1, max_length=100)
    vendor_name_raw: str | None = Field(default=None, max_length=200)
    invoice_number: str | None = Field(default=None, min_length=1, max_length=100)
    invoice_date: date | None = None
    due_date: date | None = None
    amount: Money | None = Field(default=None, gt=0)
    prev_payments: Money | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=2000)
    processing_notes: str | None = Field(default=None, max_length=2000)


class BillRead(BillBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    vendor_account_id: UUID | None = None  # None while the bill is unmatched
    submitted_by: UserSummary
    status: BillStatus
    exception_reason: str | None = None
    document_path: str | None = None
    created_at: datetime

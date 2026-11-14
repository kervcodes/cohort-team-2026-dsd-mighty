from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.common import AccountStatus
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
    property_address: str | None = Field(default=None, max_length=300)
    account_status: AccountStatus | None = None
    website_name: str | None = Field(default=None, max_length=500)


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
    property_address: str | None = Field(default=None, min_length=1, max_length=300)
    account_status: AccountStatus | None = None
    website_name: str | None = Field(default=None, max_length=500)


class BillRead(BaseModel):
    """A bill as the API returns it. A draft may leave any invoice field
    empty; a submitted bill always has `account_number_raw`, `invoice_number`,
    `invoice_date`, `due_date` and `amount` (the `bills_required_unless_draft`
    check)."""

    id: UUID
    account_number_raw: str | None = None
    vendor_name_raw: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    amount: Decimal | None = None
    prev_payments: Decimal | None = None
    description: str | None = None
    processing_notes: str | None = None
    property_address: str | None = None
    account_status: AccountStatus | None = None
    website_name: str | None = None
    vendor_account_id: UUID | None = None  # None while the bill is unmatched
    submitted_by: UserSummary
    status: BillStatus
    exception_reason: str | None = None
    document_path: str | None = None
    created_at: datetime


class BillDraftCreate(BillUpdate):
    """Fields that may be provided when creating a draft."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class BillDraftRead(BaseModel):
    """Response returned after a draft is created."""

    bill_id: UUID
    status: BillStatus
    document_path: str | None = None


class BillDraftDetail(BillDraftCreate):
    model_config = ConfigDict(extra="ignore")
    bill_id: UUID
    status: BillStatus
    document_path: str | None = None


class BillDashboardRow(BaseModel):
    """One row of GET /bills/dashboard. Only these columns leave the server,
    whatever `list_dashboard_bills` selects."""

    bill_id: UUID
    invoice_number: str | None = None
    property_address: str | None = None
    vendor_name_raw: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    # A JSON number, as the dashboard sums it for its totals (display only).
    amount: float | None = None
    status: BillStatus
    document_path: str | None = None
    created_at: datetime


class BillDocumentUrl(BaseModel):
    document_url: str

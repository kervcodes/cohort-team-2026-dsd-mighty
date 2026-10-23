from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from backend.schemas.common import ActiveStatus, PaymentMethod


class VendorAccountBase(BaseModel):
    account_number: str = Field(min_length=1, max_length=100)
    account_type: str = Field(min_length=1, max_length=50)
    payment_method: PaymentMethod
    portal_url: HttpUrl | None = None


class VendorAccountCreate(VendorAccountBase):
    model_config = ConfigDict(extra="forbid")

    property_id: UUID
    vendor_id: UUID
    status: ActiveStatus


class VendorAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_number: str | None = Field(default=None, min_length=1, max_length=100)
    account_type: str | None = Field(default=None, min_length=1, max_length=50)
    payment_method: PaymentMethod | None = None
    portal_url: HttpUrl | None = None
    status: ActiveStatus | None = None


class VendorAccountRead(VendorAccountBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    property_id: UUID
    vendor_id: UUID
    status: ActiveStatus
    created_at: datetime

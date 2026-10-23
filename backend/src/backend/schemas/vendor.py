from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from backend.schemas.common import PaymentMethod


class VendorBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=30)
    default_payment_method: PaymentMethod | None = None


class VendorCreate(VendorBase):
    model_config = ConfigDict(extra="forbid")


class VendorRead(VendorBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class VendorUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_email: str | None = None
    contact_phone: str | None = None
    default_payment_method: PaymentMethod | None = None

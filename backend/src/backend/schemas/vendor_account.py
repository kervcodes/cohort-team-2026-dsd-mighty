from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    SecretStr,
    model_validator,
)

from backend.schemas.common import ActiveStatus, PaymentMethod


class VendorAccountBase(BaseModel):
    account_number: str = Field(min_length=1, max_length=100)
    account_type: str = Field(min_length=1, max_length=50)
    payment_method: PaymentMethod
    portal_url: HttpUrl | None = None
    portal_login_email: EmailStr | None = None


class VendorAccountCreate(VendorAccountBase):
    model_config = ConfigDict(extra="forbid")

    property_id: UUID
    vendor_id: UUID
    status: ActiveStatus = "active"
    # Write-only: it goes to Vault, never to a column or a response. SecretStr
    # keeps it out of reprs, logs and model dumps.
    portal_password: SecretStr | None = Field(
        default=None, min_length=1, max_length=200
    )


class VendorAccountUpdate(BaseModel):
    """Omitted fields stay as they are; null clears a nullable field.

    For `portal_password`, null deletes the stored password and a value
    replaces it.
    """

    model_config = ConfigDict(extra="forbid")

    account_number: str | None = Field(default=None, min_length=1, max_length=100)
    account_type: str | None = Field(default=None, min_length=1, max_length=50)
    payment_method: PaymentMethod | None = None
    portal_url: HttpUrl | None = None
    portal_login_email: EmailStr | None = None
    status: ActiveStatus | None = None
    portal_password: SecretStr | None = Field(
        default=None, min_length=1, max_length=200
    )

    @model_validator(mode="after")
    def required_fields_are_not_cleared(self) -> Self:
        # These columns are not null: an explicit null is a client error, not
        # a 500 from the database.
        for name in ("account_number", "account_type", "payment_method", "status"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class VendorAccountRead(VendorAccountBase):
    """Never carries the password or its Vault secret id."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    property_id: UUID
    vendor_id: UUID
    status: ActiveStatus
    portal_password_set: bool
    created_at: datetime


class VendorAccountOption(BaseModel):
    """An active vendor account as the bill form lists it (GET /vendor-accounts)."""

    id: UUID
    account_number: str
    vendor_id: UUID
    vendor_name: str
    property_id: UUID
    property_name: str

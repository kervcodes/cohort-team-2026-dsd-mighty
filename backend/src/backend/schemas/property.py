from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.schemas.common import ActiveStatus


class Address(BaseModel):
    model_config = ConfigDict(
        extra="forbid", from_attributes=True, str_strip_whitespace=True
    )

    street: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    # Two letters, as the properties_state check allows; stored uppercased.
    state: str = Field(pattern=r"^[A-Za-z]{2}$")
    # The properties_zip_code check: 5 digits, or ZIP+4.
    zip_code: str = Field(pattern=r"^\d{5}(-\d{4})?$")

    @field_validator("state")
    @classmethod
    def _uppercase_state(cls, state: str) -> str:
        return state.upper()


class PropertyBase(BaseModel):
    property_name: str = Field(min_length=1, max_length=200)
    address: Address
    status: ActiveStatus


class PropertyCreate(PropertyBase):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # A new property is active unless the request says otherwise.
    status: ActiveStatus = "active"


class PropertyRead(PropertyBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class PropertyUpdate(BaseModel):
    """PATCH /properties/{id}: the fields to change. A new address replaces the
    whole address. Every column is required, so null never clears one, and a
    body that changes nothing is refused."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    property_name: str | None = Field(default=None, min_length=1, max_length=200)
    address: Address | None = None
    status: ActiveStatus | None = None

    @model_validator(mode="after")
    def _changes_something(self) -> "PropertyUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class PagePropertyRead(BaseModel):
    """One page of properties; `total` counts every match, not just this page."""

    items: list[PropertyRead]
    total: int
    skip: int
    limit: int

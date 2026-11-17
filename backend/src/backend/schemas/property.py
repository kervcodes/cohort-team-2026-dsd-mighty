from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    model_config = ConfigDict(extra="forbid")

    property_name: str | None = Field(default=None, min_length=1, max_length=200)
    address: Address | None = None
    status: ActiveStatus | None = None


class PagePropertyRead(BaseModel):
    """One page of properties; `total` counts every match, not just this page."""

    items: list[PropertyRead]
    total: int
    skip: int
    limit: int

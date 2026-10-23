from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.common import ActiveStatus


class Address(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    street: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=2, max_length=2)
    zip_code: str = Field(pattern=r"^\d{5}(-\d{4})?$")


class PropertyBase(BaseModel):
    property_name: str = Field(min_length=1, max_length=200)
    address: Address
    status: ActiveStatus


class PropertyCreate(PropertyBase):
    model_config = ConfigDict(extra="forbid")


class PropertyRead(PropertyBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class PropertyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    property_name: str | None = Field(default=None, min_length=1, max_length=200)
    address: Address | None = None
    status: ActiveStatus | None = None

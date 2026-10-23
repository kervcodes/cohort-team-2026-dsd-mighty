from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from backend.schemas.common import ActiveStatus


class UserRole(StrEnum):
    submitter = "submitter"
    approver = "approver"
    admin = "admin"


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str


class UserRead(UserSummary):
    email: EmailStr
    role: UserRole
    status: ActiveStatus
    created_at: datetime


class UserSelfUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=200)


class UserAdminUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: UserRole | None = None
    status: ActiveStatus | None = None

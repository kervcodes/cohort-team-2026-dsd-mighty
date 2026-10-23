from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.user import UserSummary


class AuditAction(StrEnum):
    bill_created = "bill_created"
    status_changed = "status_changed"
    approval_requested = "approval_requested"
    approval_decided = "approval_decided"
    payment_attempted = "payment_attempted"
    payment_completed = "payment_completed"
    payment_failed = "payment_failed"


class AuditEventBase(BaseModel):
    action: AuditAction
    old_status: str | None = Field(default=None, max_length=50)
    new_status: str = Field(min_length=1, max_length=50)
    details: str | None = Field(default=None, max_length=2000)


class AuditEventCreate(AuditEventBase):
    model_config = ConfigDict(extra="forbid")

    bill_id: UUID
    performed_by: UUID | None = None  # None for system-generated events
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))


class AuditEventRead(AuditEventBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    bill_id: UUID
    performed_by: UserSummary | None = None
    timestamp: datetime

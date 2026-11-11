from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AuditAction(StrEnum):
    bill_created = "bill_created"
    status_changed = "status_changed"
    approval_requested = "approval_requested"
    approval_decided = "approval_decided"
    payment_attempted = "payment_attempted"
    payment_completed = "payment_completed"
    payment_failed = "payment_failed"


# Field names and nullability are those of public.audit_events (migration
# 20261027135848_create_bill_workflow_tables).
class AuditEventBase(BaseModel):
    action: AuditAction
    old_status: str | None = Field(default=None, max_length=50)
    new_status: str | None = Field(default=None, max_length=50)
    details: str | None = Field(default=None, max_length=2000)


class AuditEventCreate(AuditEventBase):
    model_config = ConfigDict(extra="forbid")

    bill_id: UUID
    user_id: UUID | None = None  # None for system-generated events
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class AuditEventRead(AuditEventBase):
    model_config = ConfigDict(from_attributes=True)

    event_id: UUID
    bill_id: UUID
    user_id: UUID | None = None
    occurred_at: datetime

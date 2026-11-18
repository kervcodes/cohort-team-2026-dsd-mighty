"""The audit log as the API serves it (DC-89): `GET /audit/changes` and
`GET /bills/{bill_id}/history`.

The log is `audit.record_changes` (migration 20261110180000_create_audit_trail),
read through the `audit_changes` and `audit_bill_changes` functions (migration
20261118100000_audit_read_functions). `before` and `after` are its `old_row`
and `new_row` exactly as stored: sensitive values were masked when the row was
written, and nothing here unmasks or adds to them.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

# The tables the audit triggers watch, by their table_name in the log: the
# values the `table` filter accepts (as the SQL function's allow-list does).
# Responses carry the table as a plain string, so a table audited later is
# still served before this list learns it.
AuditTable = Literal[
    "bills",
    "approvals",
    "payments",
    "vendors",
    "vendor_accounts",
    "properties",
    "app_users",
    "autopay_settings",
]

AuditOp = Literal["INSERT", "UPDATE", "DELETE"]


class ChangeAction(StrEnum):
    created = "created"
    changed = "changed"
    deleted = "deleted"


ACTION_OF_OP: dict[AuditOp, ChangeAction] = {
    "INSERT": ChangeAction.created,
    "UPDATE": ChangeAction.changed,
    "DELETE": ChangeAction.deleted,
}


class LogRow(BaseModel):
    """One row of `audit_changes` / `audit_bill_changes`: a log row as stored,
    plus the actor's current full name."""

    id: int
    table_name: str
    op: AuditOp
    record_pk: dict[str, Any] | None = None
    bill_id: UUID | None = None
    old_row: dict[str, Any] | None = None
    new_row: dict[str, Any] | None = None
    changed_cols: list[str] | None = None
    actor_id: UUID | None = None
    actor_role: str | None = None
    actor_name: str | None = None
    occurred_at: datetime


class ChangeActor(BaseModel):
    id: UUID | None
    name: str | None
    role: str | None


class AuditChange(BaseModel):
    id: int
    occurred_at: datetime
    table: str
    action: ChangeAction
    record_id: str | None
    bill_id: UUID | None
    actor: ChangeActor
    changed_fields: list[str]
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class AuditChangePage(BaseModel):
    """`GET /audit/changes`: newest first; pass `next_before_id` as
    `before_id` for the next page (null when there is none)."""

    items: list[AuditChange]
    next_before_id: int | None


class BillEventKind(StrEnum):
    bill_created = "bill_created"
    bill_updated = "bill_updated"
    bill_submitted = "bill_submitted"
    bill_resubmitted = "bill_resubmitted"
    document_added = "document_added"
    document_replaced = "document_replaced"
    vendor_account_matched = "vendor_account_matched"
    bill_approved = "bill_approved"
    bill_rejected = "bill_rejected"
    payment_recorded = "payment_recorded"
    payment_failed = "payment_failed"
    bill_paid = "bill_paid"
    run_started = "run_started"
    run_paid = "run_paid"
    run_failed = "run_failed"
    run_flagged = "run_flagged"
    other = "other"


class EventActor(BaseModel):
    id: UUID
    name: str | None


class BillEvent(BaseModel):
    at: datetime
    kind: BillEventKind
    summary: str
    detail: str | None = None
    actor: EventActor | None = None
    # The log row the event comes from; null for a payment run event.
    change_id: int | None = None
    # The payment run the event comes from; null for a log event.
    run_id: UUID | None = None


class BillHistory(BaseModel):
    """`GET /bills/{bill_id}/history`: oldest first."""

    bill_id: UUID
    events: list[BillEvent]

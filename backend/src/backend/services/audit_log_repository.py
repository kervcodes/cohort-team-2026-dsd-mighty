"""Reads the audit log (`audit.record_changes`) through the service-role-only
`audit_changes` and `audit_bill_changes` functions (migration
20261118100000_audit_read_functions).

This module is the backend's only reader of the log, and only the admin routes
in `backend.api.audit` call it (tests/test_audit_log.py checks both). Rows are
returned as stored, masked values included.
"""

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from backend.schemas.audit_log import (
    ACTION_OF_OP,
    AuditChange,
    AuditChangePage,
    AuditTable,
    ChangeAction,
    ChangeActor,
    LogRow,
)
from supabase import Client


@dataclass(frozen=True)
class ChangeFilters:
    table: AuditTable | None = None
    actor_id: UUID | None = None
    bill_id: UUID | None = None
    from_day: date | None = None
    to_day: date | None = None
    before_id: int | None = None
    limit: int = 50


def _str_or_none(value: object) -> str | None:
    return None if value is None else str(value)


def _record_id(value: object) -> str | None:
    # A single-row table (autopay_settings) is keyed by a constant `true`,
    # which names no record.
    if value is None or isinstance(value, bool):
        return None
    return str(value)


def to_change(row: LogRow) -> AuditChange:
    action = ACTION_OF_OP[row.op]
    # The trigger keys record_pk by the table's one primary key column.
    pk_values = list((row.record_pk or {}).values())
    record_id = _record_id(pk_values[0]) if len(pk_values) == 1 else None
    return AuditChange(
        id=row.id,
        occurred_at=row.occurred_at,
        table=row.table_name,
        action=action,
        record_id=record_id,
        bill_id=row.bill_id,
        actor=ChangeActor(id=row.actor_id, name=row.actor_name, role=row.actor_role),
        changed_fields=(
            list(row.changed_cols or []) if action is ChangeAction.changed else []
        ),
        before=row.old_row,
        after=row.new_row,
    )


def list_changes(client: Client, filters: ChangeFilters) -> AuditChangePage:
    """A page of the log, newest first."""
    params = {
        "p_table": filters.table,
        "p_actor_id": _str_or_none(filters.actor_id),
        "p_bill_id": _str_or_none(filters.bill_id),
        "p_from": _str_or_none(filters.from_day),
        "p_to": _str_or_none(filters.to_day),
        "p_before_id": filters.before_id,
        "p_limit": filters.limit,
    }
    rows = client.rpc("audit_changes", params).execute().data or []
    items = [to_change(LogRow.model_validate(row)) for row in rows]
    # has_more is the same on every row of the page.
    more = bool(rows) and bool(rows[0]["has_more"])
    return AuditChangePage(
        items=items,
        next_before_id=items[-1].id if more else None,
    )


def list_bill_changes(client: Client, bill_id: UUID) -> list[LogRow]:
    """Every log row of the bill, its approvals and payments, oldest first."""
    response = client.rpc("audit_bill_changes", {"p_bill_id": str(bill_id)}).execute()
    return [LogRow.model_validate(row) for row in response.data or []]

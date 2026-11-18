"""A bill's history (`GET /bills/{bill_id}/history`): readable events built
from the bill's audit log rows (the bill, its approvals and payments) and its
payment runs, oldest first.

`bill_events` is pure: it reads only the rows it is given. Values come from
the log as stored, so a masked account number stays masked.

How each log row becomes events:

- bills INSERT: `bill_created`, then `document_added` when it has a PDF and
  `vendor_account_matched` when it has a vendor account.
- bills UPDATE: `document_added` / `document_replaced`,
  `vendor_account_matched`, then `bill_updated` for the other fields of a
  draft, then the status change: `bill_submitted` (draft ->
  pending_approval), `bill_resubmitted` (rejected -> pending_approval),
  `bill_paid` (-> paid), whose detail lists the other fields changed with it
  ("Amount changed"). A status change to approved or rejected is told by its
  approval row, so it adds no event of its own. Anything left is `other`.
- approvals: `bill_approved` / `bill_rejected` when approval_status becomes
  approved / rejected. The pending approval a submission creates is part of
  that submission and adds no event.
- payments INSERT: `payment_recorded` (completed) / `payment_failed` (failed).
- Anything else on the bill (a delete, a pending payment, ...): `other`.

Payment runs are not in the log; each gives `run_started` at its creation
and, once it ends, `run_paid` / `run_failed` / `run_flagged`.
"""

from decimal import Decimal
from typing import Any
from uuid import UUID

from backend.schemas.audit_log import (
    ACTION_OF_OP,
    BillEvent,
    BillEventKind,
    BillHistory,
    EventActor,
    LogRow,
)
from backend.services.audit_log_repository import list_bill_changes
from supabase import Client

K = BillEventKind

METHOD_LABELS = {
    "ach": "ACH",
    "check": "Check",
    "wire": "Wire",
    "credit_card": "Card",
    "other": "Other",
}

# Bill columns as a person reads them, for "Draft updated".
FIELD_LABELS = {
    "account_number_raw": "account number",
    "vendor_name_raw": "vendor name",
    "invoice_number": "invoice number",
    "invoice_date": "invoice date",
    "due_date": "due date",
    "amount": "amount",
    "prev_payments": "previous payments",
    "description": "description",
    "processing_notes": "processing notes",
    "property_address": "property address",
    "account_status": "account status",
    "website_name": "website",
    "exception_reason": "exception reason",
    "document_path": "PDF",
    "vendor_id": "vendor",
    "property_id": "property",
    "vendor_account_id": "vendor account",
    "vendor_account_picked": "vendor account choice",
    "property_address_mismatch": "property address check",
    "status": "status",
}

# The bill columns the backend's match writes together with the account.
MATCH_FIELDS = frozenset(
    {
        "vendor_account_id",
        "vendor_id",
        "property_id",
        "vendor_account_picked",
        "property_address_mismatch",
    }
)

# Status changes with an event of their own. approved and rejected are told by
# the approval row (bill_approved / bill_rejected).
SUBMITTED = ("draft", "pending_approval")
RESUBMITTED = ("rejected", "pending_approval")
TOLD_BY_APPROVAL = frozenset({"approved", "rejected"})

RUN_FINAL = {
    "paid": (K.run_paid, "Paid by AI on the vendor portal"),
    "failed": (K.run_failed, "The portal declined the payment"),
    "flagged": (K.run_flagged, "Flagged for a person"),
}


def dollars(amount: Any) -> str:
    return f"${Decimal(str(amount)):,.2f}"


def readable_list(columns: list[str]) -> str:
    labels = [FIELD_LABELS.get(c, c.replace("_", " ")) for c in columns]
    text = (
        labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} and {labels[-1]}"
    )
    return text[0].upper() + text[1:]


def _log_event(
    row: LogRow, kind: BillEventKind, summary: str, detail: str | None = None
) -> BillEvent:
    actor = (
        EventActor(id=row.actor_id, name=row.actor_name)
        if row.actor_id is not None
        else None
    )
    return BillEvent(
        at=row.occurred_at,
        kind=kind,
        summary=summary,
        detail=detail,
        actor=actor,
        change_id=row.id,
    )


def _other(row: LogRow) -> BillEvent:
    table = row.table_name.replace("_", " ").capitalize()
    return _log_event(row, K.other, f"{table} {ACTION_OF_OP[row.op]}")


def _matched(
    row: LogRow, new: dict[str, Any], vendor_names: dict[str, str]
) -> BillEvent:
    vendor = vendor_names.get(str(new["vendor_account_id"]))
    # The bill's account number as the log stored it: masked.
    number = new.get("account_number_raw")
    if vendor and number:
        detail = f"{vendor}, account {number}"
    elif number:
        detail = f"Account {number}"
    else:
        detail = vendor
    return _log_event(
        row, K.vendor_account_matched, "Matched to a vendor account", detail
    )


def _bill_insert(row: LogRow, vendor_names: dict[str, str]) -> list[BillEvent]:
    new = row.new_row or {}
    summary = (
        "Created as a draft"
        if new.get("status") == "draft"
        else "Created and submitted for approval"
    )
    events = [_log_event(row, K.bill_created, summary)]
    if new.get("document_path"):
        events.append(_log_event(row, K.document_added, "PDF added"))
    if new.get("vendor_account_id"):
        events.append(_matched(row, new, vendor_names))
    return events


def _status_event(row: LogRow, old: str | None, new: str | None) -> BillEvent | None:
    if (old, new) == SUBMITTED:
        return _log_event(row, K.bill_submitted, "Submitted for approval")
    if (old, new) == RESUBMITTED:
        return _log_event(row, K.bill_resubmitted, "Resubmitted for approval")
    if new == "paid":
        return _log_event(row, K.bill_paid, "Marked paid")
    return None


def _bill_update(row: LogRow, vendor_names: dict[str, str]) -> list[BillEvent]:
    old, new = row.old_row or {}, row.new_row or {}
    changed = list(row.changed_cols or [])
    events: list[BillEvent] = []
    covered: set[str] = set()

    if "document_path" in changed and new.get("document_path"):
        replaced = bool(old.get("document_path"))
        events.append(
            _log_event(row, K.document_replaced, "PDF replaced")
            if replaced
            else _log_event(row, K.document_added, "PDF added")
        )
        covered.add("document_path")

    if "vendor_account_id" in changed and new.get("vendor_account_id"):
        events.append(_matched(row, new, vendor_names))
        covered |= MATCH_FIELDS

    status_event = None
    status_told = False
    if "status" in changed:
        status_event = _status_event(row, old.get("status"), new.get("status"))
        status_told = status_event is not None or new.get("status") in TOLD_BY_APPROVAL
        if status_told:
            covered.add("status")

    rest = [column for column in changed if column not in covered]
    if rest and status_event is not None:
        # One event for the update: the status change says what else changed.
        status_event = status_event.model_copy(
            update={"detail": f"{readable_list(rest)} changed"}
        )
    elif rest and not status_told:
        if old.get("status") == "draft" and new.get("status") == "draft":
            events.append(
                _log_event(row, K.bill_updated, "Draft updated", readable_list(rest))
            )
        else:
            events.append(_other(row))

    if status_event is not None:
        events.append(status_event)
    return events


def _bill_row_events(row: LogRow, vendor_names: dict[str, str]) -> list[BillEvent]:
    if row.op == "INSERT":
        return _bill_insert(row, vendor_names)
    if row.op == "UPDATE":
        return _bill_update(row, vendor_names)
    return [_other(row)]


def _approval_events(row: LogRow) -> list[BillEvent]:
    old, new = row.old_row or {}, row.new_row or {}
    status = new.get("approval_status")
    became = row.op != "DELETE" and (
        row.op == "INSERT" or old.get("approval_status") != status
    )
    if became and status == "approved":
        return [_log_event(row, K.bill_approved, "Approved", new.get("comments"))]
    if became and status == "rejected":
        return [_log_event(row, K.bill_rejected, "Rejected", new.get("comments"))]
    if row.op == "INSERT" and status == "pending":
        # The approval request of a submission: told by bill_submitted.
        return []
    return [_other(row)]


def _payment_events(row: LogRow) -> list[BillEvent]:
    new = row.new_row or {}
    if row.op == "INSERT" and new.get("payment_status") == "completed":
        method = METHOD_LABELS.get(new.get("payment_method") or "", "Other")
        detail = f"{dollars(new['amount'])} by {method}"
        if new.get("provider_reference"):
            detail += f", reference {new['provider_reference']}"
        return [_log_event(row, K.payment_recorded, "Payment recorded", detail)]
    if row.op == "INSERT" and new.get("payment_status") == "failed":
        return [
            _log_event(
                row,
                K.payment_failed,
                "Payment attempt failed",
                new.get("failure_reason"),
            )
        ]
    return [_other(row)]


def _row_events(row: LogRow, vendor_names: dict[str, str]) -> list[BillEvent]:
    if row.table_name == "bills":
        return _bill_row_events(row, vendor_names)
    if row.table_name == "approvals":
        return _approval_events(row)
    if row.table_name == "payments":
        return _payment_events(row)
    return [_other(row)]


def _run_events(run: dict[str, Any]) -> list[BillEvent]:
    # payment_runs.trigger arrives with autopay; until then the key is absent.
    autopay = run.get("trigger") == "autopay"
    starter = run.get("starter") or {}
    events = [
        BillEvent(
            at=run["created_at"],
            kind=K.run_started,
            summary=(
                "Autopay started a payment run" if autopay else "Pay with AI started"
            ),
            actor=EventActor(id=run["started_by"], name=starter.get("full_name")),
            run_id=run["run_id"],
        )
    ]

    final = RUN_FINAL.get(run["status"])
    if final is not None and run.get("finished_at"):
        kind, summary = final
        if kind is K.run_paid:
            detail = (run.get("receipt") or {}).get("confirmation_number")
        elif kind is K.run_flagged:
            detail = run.get("flag_reason")
        else:
            detail = None
        events.append(
            BillEvent(
                at=run["finished_at"],
                kind=kind,
                summary=summary,
                detail=detail,
                run_id=run["run_id"],
            )
        )
    return events


def bill_events(
    rows: list[LogRow],
    runs: list[dict[str, Any]],
    vendor_names: dict[str, str],
) -> list[BillEvent]:
    """The bill's events, oldest first. `rows` are its log rows oldest first,
    `runs` its payment_runs rows, `vendor_names` vendor account id -> vendor
    name."""
    events = [event for row in rows for event in _row_events(row, vendor_names)]
    events += [event for run in runs for event in _run_events(run)]
    # Stable: events of one log row, and rows of one instant, keep their order.
    return sorted(events, key=lambda event: event.at)


def _bill_exists(client: Client, bill_id: UUID) -> bool:
    response = (
        client.table("bills")
        .select("bill_id")
        .eq("bill_id", str(bill_id))
        .maybe_single()
        .execute()
    )
    # maybe_single() returns None (not an empty result) when no row matches.
    return response is not None and isinstance(response.data, dict)


def _bill_runs(client: Client, bill_id: UUID) -> list[dict[str, Any]]:
    # Every column (*), so payment_runs.trigger is read once it exists and its
    # absence is no error.
    response = (
        client.table("payment_runs")
        .select("*,starter:app_users!started_by(full_name)")
        .eq("bill_id", str(bill_id))
        .order("created_at")
        .execute()
    )
    return response.data or []


def _vendor_names(client: Client, rows: list[LogRow]) -> dict[str, str]:
    account_ids = {
        str(row.new_row["vendor_account_id"])
        for row in rows
        if row.table_name == "bills" and (row.new_row or {}).get("vendor_account_id")
    }
    names = {}
    for account_id in sorted(account_ids):
        response = (
            client.table("vendor_accounts")
            .select("account_id,vendor:vendors!vendor_id(vendor_name)")
            .eq("account_id", account_id)
            .maybe_single()
            .execute()
        )
        account = response.data if response is not None else None
        vendor = account.get("vendor") if isinstance(account, dict) else None
        if vendor and vendor.get("vendor_name"):
            names[account_id] = vendor["vendor_name"]
    return names


def load_bill_history(client: Client, bill_id: UUID) -> BillHistory | None:
    """The bill's history, or None when there is no such bill."""
    if not _bill_exists(client, bill_id):
        return None
    rows = list_bill_changes(client, bill_id)
    events = bill_events(rows, _bill_runs(client, bill_id), _vendor_names(client, rows))
    return BillHistory(bill_id=bill_id, events=events)

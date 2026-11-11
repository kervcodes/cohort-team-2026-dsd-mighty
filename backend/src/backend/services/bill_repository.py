from typing import Any
from uuid import UUID

from postgrest import SyncSelectRequestBuilder

from backend.schemas.bill import (
    BillCreate,
    BillDraftCreate,
    BillRead,
    BillStatus,
)
from backend.services.bill_access import (
    BillScope,
    editable_bills,
    readable_bills,
)
from supabase import Client

BILL_COLUMNS = (
    "bill_id,account_number_raw,vendor_name_raw,invoice_number,"
    "invoice_date,due_date,amount,prev_payments,description,"
    "processing_notes,property_address,account_status,website_name,"
    "vendor_account_id,status,exception_reason,document_path,created_at,"
    # The submitter's name, embedded through the bills.submitted_by foreign key.
    "submitter:app_users!submitted_by(user_id,full_name)"
)

DASHBOARD_COLUMNS = (
    "bill_id,invoice_number,property_address,"
    "vendor_name_raw,invoice_date,due_date,"
    "amount,status,document_path,created_at"
)

DRAFT_COLUMNS = "bill_id,status,document_path"

LIST_LIMIT = 100


def _to_bill(row: dict[str, Any]) -> BillRead:
    submitter = row["submitter"]
    return BillRead.model_validate(
        {
            **row,
            "id": row["bill_id"],
            "submitted_by": {
                "id": submitter["user_id"],
                "full_name": submitter["full_name"],
            },
        }
    )


def save_bill(
    client: Client,
    fields: BillCreate | BillDraftCreate,
    user_id: UUID,
    status: BillStatus,
) -> BillRead:
    """Insert a new bill submitted by `user_id`: the one save path for both
    Create (`pending_approval`) and Save draft (`draft`)."""
    payload = fields.model_dump(
        mode="json",
        exclude_none=True,
    )

    payload["submitted_by"] = str(user_id)
    payload["status"] = status

    response = (
        client.table("bills").insert(payload).select(BILL_COLUMNS).single().execute()
    )

    row = response.data
    if not isinstance(row, dict):
        kind = type(row).__name__
        raise RuntimeError(f"Expected one bill row from insert, got {kind}")

    return _to_bill(row)


def _readable(
    client: Client,
    columns: str,
    user_id: UUID,
    scope: BillScope,
) -> SyncSelectRequestBuilder:
    return client.table("bills").select(columns).or_(readable_bills(user_id, scope))


def list_readable_bills(
    client: Client,
    user_id: UUID,
    scope: BillScope,
) -> list[BillRead]:
    response = (
        _readable(client, BILL_COLUMNS, user_id, scope)
        .order("created_at", desc=True)
        .limit(LIST_LIMIT)
        .execute()
    )

    return [_to_bill(row) for row in response.data or []]


def get_readable_bill(
    client: Client,
    bill_id: UUID,
    user_id: UUID,
) -> BillRead | None:
    """The bill, or None when it does not exist or `user_id` may not read it,
    so a caller cannot tell the two apart."""
    response = (
        _readable(client, BILL_COLUMNS, user_id, BillScope.all)
        .eq("bill_id", str(bill_id))
        .maybe_single()
        .execute()
    )

    return _to_bill(response.data) if response else None


def list_dashboard_bills(
    client: Client,
    user_id: UUID,
    scope: BillScope,
) -> list[dict]:
    response = (
        _readable(client, DASHBOARD_COLUMNS, user_id, scope)
        .order("created_at", desc=True)
        .limit(LIST_LIMIT)
        .execute()
    )

    return response.data or []


def _editable(
    query: SyncSelectRequestBuilder,
    user_id: str,
) -> SyncSelectRequestBuilder:
    for column, value in editable_bills(user_id).items():
        query = query.eq(column, value)
    return query


def get_editable_draft(
    client: Client,
    bill_id: UUID,
    user_id: str,
) -> dict | None:
    response = (
        _editable(
            client.table("bills").select(DRAFT_COLUMNS).eq("bill_id", str(bill_id)),
            user_id,
        )
        .maybe_single()
        .execute()
    )

    return response.data if response else None


def attach_document(
    client: Client,
    bill_id: UUID,
    user_id: str,
    storage_path: str,
) -> dict | None:
    response = (
        _editable(
            client.table("bills")
            .update({"document_path": storage_path})
            .eq("bill_id", str(bill_id)),
            user_id,
        )
        .is_("document_path", "null")
        .select(DRAFT_COLUMNS)
        .execute()
    )

    rows = response.data or []

    return rows[0] if len(rows) == 1 else None


def update_draft(
    client: Client,
    bill_id: UUID,
    user_id: str,
    draft: BillDraftCreate,
) -> dict | None:
    """Update the caller's own draft; return None if no such draft exists.

    `exclude_unset` keeps explicit nulls, so a field cleared in the form is
    cleared in the database, while fields the client did not send are left
    untouched.
    """
    payload = draft.model_dump(mode="json", exclude_unset=True)

    if not payload:
        return get_editable_draft(client, bill_id, user_id)

    response = (
        _editable(
            client.table("bills").update(payload).eq("bill_id", str(bill_id)),
            user_id,
        )
        .select(DRAFT_COLUMNS)
        .execute()
    )

    rows = response.data or []

    return rows[0] if len(rows) == 1 else None

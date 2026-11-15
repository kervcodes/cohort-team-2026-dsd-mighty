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
    own_bills,
    readable_bills,
)
from supabase import Client

BILL_COLUMNS = (
    "bill_id,account_number_raw,vendor_name_raw,invoice_number,"
    "invoice_date,due_date,amount,prev_payments,description,"
    "processing_notes,property_address,account_status,website_name,"
    "vendor_account_id,status,exception_reason,document_path,created_at,"
    "submitter:app_users!submitted_by(user_id,full_name)"
)

DASHBOARD_COLUMNS = (
    "bill_id,invoice_number,property_address,"
    "vendor_name_raw,invoice_date,due_date,"
    "amount,status,document_path,created_at"
)

DRAFT_COLUMNS = "bill_id,status,document_path"

LIST_LIMIT = 100


# ---------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------


def _to_bill(row: dict[str, Any]) -> BillRead:
    """Convert a database bill row into the BillRead schema."""
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


def _get_bill_by_id(
    client: Client,
    bill_id: UUID,
) -> BillRead:
    """Fetch a bill after a successful database submission."""
    response = (
        client.table("bills")
        .select(BILL_COLUMNS)
        .eq("bill_id", str(bill_id))
        .single()
        .execute()
    )

    row = response.data

    if not isinstance(row, dict):
        raise RuntimeError("Expected one bill row after submission.")

    return _to_bill(row)


# ---------------------------------------------------------
# Bill creation
# ---------------------------------------------------------


def save_bill(
    client: Client,
    fields: BillCreate | BillDraftCreate,
    user_id: UUID,
    status: BillStatus,
) -> BillRead:
    """Insert a new bill.

    Used for saving a new draft. For a new invoice submission,
    use submit_bill_with_approval instead.
    """
    payload = fields.model_dump(
        mode="json",
        exclude_none=True,
    )

    payload["submitted_by"] = str(user_id)
    payload["status"] = status.value

    response = (
        client.table("bills").insert(payload).select(BILL_COLUMNS).single().execute()
    )

    row = response.data

    if not isinstance(row, dict):
        raise RuntimeError("Expected one bill row from insert.")

    return _to_bill(row)


def submit_bill_with_approval(
    client: Client,
    fields: BillCreate,
    user_id: UUID,
) -> BillRead:
    """Create a brand-new invoice and its pending approval transactionally."""
    payload = fields.model_dump(mode="json")

    response = client.rpc(
        "create_bill_with_approval",
        {
            "p_fields": payload,
            "p_user_id": str(user_id),
        },
    ).execute()

    if response.data is None:
        raise RuntimeError("Bill submission did not return a bill ID.")

    bill_id = UUID(str(response.data))

    return _get_bill_by_id(client, bill_id)


# ---------------------------------------------------------
# Bill resubmission
# ---------------------------------------------------------


def resubmit_bill_with_approval(
    client: Client,
    bill_id: UUID,
    fields: BillCreate,
    user_id: UUID,
) -> BillRead:
    """Resubmit a previously rejected invoice.

    The database function updates the existing bill, preserves
    its document_path and rejected approval history, and creates
    a new pending approval record.
    """
    payload = fields.model_dump(mode="json")

    response = client.rpc(
        "resubmit_bill_with_approval",
        {
            "p_bill_id": str(bill_id),
            "p_fields": payload,
            "p_user_id": str(user_id),
        },
    ).execute()

    if response.data is None:
        raise RuntimeError("Bill resubmission did not return a bill ID.")

    resubmitted_bill_id = UUID(str(response.data))

    return _get_bill_by_id(client, resubmitted_bill_id)


# ---------------------------------------------------------
# Bill access and listing
# ---------------------------------------------------------


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
    """Return a readable bill, or None if missing or inaccessible."""
    response = (
        _readable(
            client,
            BILL_COLUMNS,
            user_id,
            BillScope.all,
        )
        .eq("bill_id", str(bill_id))
        .maybe_single()
        .execute()
    )

    row = response.data

    if not isinstance(row, dict):
        return None

    return _to_bill(row)


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


# ---------------------------------------------------------
# Draft filtering and retrieval
# ---------------------------------------------------------


def _filtered(
    query: SyncSelectRequestBuilder,
    filters: dict[str, str],
) -> SyncSelectRequestBuilder:
    for column, value in filters.items():
        query = query.eq(column, value)

    return query


def _editable(
    query: SyncSelectRequestBuilder,
    user_id: str,
) -> SyncSelectRequestBuilder:
    """Restrict a query to the caller's editable drafts."""
    return _filtered(
        query,
        editable_bills(user_id),
    )


def get_editable_draft(
    client: Client,
    bill_id: UUID,
    user_id: str,
) -> dict | None:
    """Return the caller's own editable draft."""
    response = (
        _editable(
            client.table("bills").select("*").eq("bill_id", str(bill_id)),
            user_id,
        )
        .maybe_single()
        .execute()
    )

    return response.data


# ---------------------------------------------------------
# PDF attachment
# ---------------------------------------------------------


def attach_document(
    client: Client,
    bill_id: UUID,
    user_id: str,
    storage_path: str,
    replacing: str | None,
) -> dict | None:
    """Attach or replace a PDF on the caller's editable draft.

    Only updates the row if its current document_path matches
    the expected value. This protects against concurrent uploads
    or a submission occurring during an upload.
    """
    query = _editable(
        client.table("bills")
        .update({"document_path": storage_path})
        .eq("bill_id", str(bill_id)),
        user_id,
    )

    query = (
        query.is_("document_path", "null")
        if replacing is None
        else query.eq("document_path", replacing)
    )

    response = query.select(DRAFT_COLUMNS).execute()

    rows = response.data or []

    return rows[0] if len(rows) == 1 else None


# ---------------------------------------------------------
# Draft creation and updates
# ---------------------------------------------------------


def update_draft(
    client: Client,
    bill_id: UUID,
    user_id: str,
    draft: BillDraftCreate,
) -> dict | None:
    """Update the caller's own draft.

    Explicit nulls clear fields. Unspecified fields remain unchanged.
    """
    payload = draft.model_dump(
        mode="json",
        exclude_unset=True,
    )

    if not payload:
        return get_editable_draft(
            client,
            bill_id,
            user_id,
        )

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


# ---------------------------------------------------------
# Draft submission
# ---------------------------------------------------------


def submit_draft_with_approval(
    client: Client,
    bill_id: UUID,
    user_id: UUID,
    fields: BillCreate,
) -> BillRead | None:
    """Submit an existing draft and create its pending approval.

    The database RPC must:
    - Verify the bill belongs to the submitting user.
    - Verify the bill is still a draft.
    - Lock the bill row.
    - Update the invoice fields.
    - Change the bill status to pending_approval.
    - Preserve the existing document_path.
    - Insert one pending approval record.
    - Return the existing bill UUID.

    Returns None if the RPC returns no bill ID.
    """
    payload = fields.model_dump(mode="json")

    response = client.rpc(
        "submit_draft_bill_with_approval",
        {
            "p_bill_id": str(bill_id),
            "p_fields": payload,
            "p_user_id": str(user_id),
        },
    ).execute()

    if response.data is None:
        return None

    submitted_bill_id = UUID(str(response.data))

    return _get_bill_by_id(
        client,
        submitted_bill_id,
    )


# ---------------------------------------------------------
# Bill ownership and status
# ---------------------------------------------------------


def get_own_bill_status(
    client: Client,
    bill_id: UUID,
    user_id: str,
) -> BillStatus | None:
    """Return the status of a bill submitted by this user.

    Another user's bill is treated as missing.
    """
    response = (
        _filtered(
            client.table("bills").select("status").eq("bill_id", str(bill_id)),
            own_bills(user_id),
        )
        .maybe_single()
        .execute()
    )

    row = response.data

    if not isinstance(row, dict):
        return None

    return BillStatus(row["status"])

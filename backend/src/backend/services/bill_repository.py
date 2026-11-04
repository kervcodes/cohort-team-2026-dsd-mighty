from uuid import UUID

from backend.schemas.bill import BillDraftCreate
from supabase import Client


def create_draft(
    client: Client,
    draft: BillDraftCreate,
    user_id: str,
) -> dict:
    payload = draft.model_dump(
        mode="json",
        exclude_none=True,
    )

    payload["submitted_by"] = user_id
    payload["status"] = "draft"

    response = (
        client.table("bills")
        .insert(payload)
        .select("bill_id,status,document_path")
        .single()
        .execute()
    )

    row = response.data
    if not isinstance(row, dict):
        kind = type(row).__name__
        raise RuntimeError(f"Expected one bill row from insert, got {kind}")

    return row


def get_editable_draft(
    client: Client,
    bill_id: UUID,
    user_id: str,
) -> dict | None:
    response = (
        client.table("bills")
        .select("bill_id,status,document_path")
        .eq("bill_id", str(bill_id))
        .eq("submitted_by", user_id)
        .eq("status", "draft")
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
        client.table("bills")
        .update({"document_path": storage_path})
        .eq("bill_id", str(bill_id))
        .eq("submitted_by", user_id)
        .eq("status", "draft")
        .is_("document_path", "null")
        .select("bill_id,status,document_path")
        .execute()
    )

    rows = response.data or []

    return rows[0] if len(rows) == 1 else None


def list_user_bills(
    client: Client,
    user_id: str,
) -> list[dict]:
    response = (
        client.table("bills")
        .select(
            "bill_id,invoice_number,property_address,"
            "vendor_name_raw,invoice_date,due_date,"
            "amount,status,document_path,created_at"
        )
        .eq("submitted_by", user_id)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    return response.data or []


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
        client.table("bills")
        .update(payload)
        .eq("bill_id", str(bill_id))
        .eq("submitted_by", user_id)
        .eq("status", "draft")
        .select("bill_id,status,document_path")
        .execute()
    )

    rows = response.data or []

    return rows[0] if len(rows) == 1 else None

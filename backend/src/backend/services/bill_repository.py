from typing import Any
from uuid import UUID

from postgrest import SyncSelectRequestBuilder
from postgrest.exceptions import APIError

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
from backend.services.property_matching import address_disagrees
from backend.services.vendor_account_matching import match_columns
from supabase import Client

BILL_COLUMNS = (
    "bill_id,account_number_raw,vendor_name_raw,invoice_number,"
    "invoice_date,due_date,amount,prev_payments,description,"
    "processing_notes,property_address,account_status,website_name,"
    "vendor_account_id,vendor_id,property_id,vendor_account_picked,"
    "property_address_mismatch,status,exception_reason,document_path,created_at,"
    # The submitter's name, embedded through the bills.submitted_by foreign key.
    "submitter:app_users!submitted_by(user_id,full_name)"
)

DASHBOARD_COLUMNS = (
    "bill_id,invoice_number,property_address,"
    "vendor_name_raw,invoice_date,due_date,"
    "amount,status,document_path,created_at,property_address_mismatch,"
    # The matched vendor and property, null while the bill is unmatched.
    "vendor:vendors!vendor_id(vendor_name),"
    "property:properties!property_id(property_name)"
)

DRAFT_COLUMNS = "bill_id,status,document_path"

LIST_LIMIT = 100

UNIQUE_VIOLATION = "23505"

# The match columns are set from the account, never from the request.
MATCH_FIELDS = {"vendor_account_id"}


class DuplicateInvoice(Exception):
    """The bill's vendor account already has a bill with this invoice number
    (index bills_account_invoice_unique)."""


def _write(query: Any) -> Any:
    """Run an insert, update or bill RPC, raising DuplicateInvoice for the
    one unique index a write can break."""
    try:
        return query.execute()
    except APIError as error:
        if error.code == UNIQUE_VIOLATION:
            raise DuplicateInvoice from error
        raise


def _rpc_fields(client: Client, fields: BillCreate) -> dict[str, Any]:
    """The bill fields for a bill RPC, with the match worked out here: the
    vendor account (picked or found by number) and its property, or the
    property the address names. Raises UnusableVendorAccount before the RPC
    if the picked account does not exist or is not active."""
    return fields.model_dump(mode="json", exclude=MATCH_FIELDS) | match_columns(
        client,
        fields.account_number_raw,
        fields.vendor_account_id,
        fields.property_address,
    )


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


def _first_row(query: SyncSelectRequestBuilder) -> dict[str, Any] | None:
    """Run a select and return its first row, or None if nothing matched.

    Avoids .maybe_single(), which returns None instead of a response
    when no row matches in current supabase-py/postgrest versions.
    """
    response = query.limit(1).execute()
    rows = response.data or []
    return rows[0] if rows else None


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
        exclude=MATCH_FIELDS,
    )

    payload["submitted_by"] = str(user_id)
    payload["status"] = status.value
    payload |= match_columns(
        client,
        fields.account_number_raw,
        fields.vendor_account_id,
        fields.property_address,
    )

    response = _write(
        client.table("bills").insert(payload).select(BILL_COLUMNS).single()
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
    payload = _rpc_fields(client, fields)

    response = _write(
        client.rpc(
            "create_bill_with_approval",
            {
                "p_fields": payload,
                "p_user_id": str(user_id),
            },
        )
    )

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
    payload = _rpc_fields(client, fields)

    response = _write(
        client.rpc(
            "resubmit_bill_with_approval",
            {
                "p_bill_id": str(bill_id),
                "p_fields": payload,
                "p_user_id": str(user_id),
            },
        )
    )

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
    row = _first_row(
        _readable(
            client,
            BILL_COLUMNS,
            user_id,
            BillScope.all,
        ).eq("bill_id", str(bill_id))
    )

    if row is None:
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

    return [
        {
            **row,
            "vendor_name": (row.pop("vendor") or {}).get("vendor_name"),
            "property_name": (row.pop("property") or {}).get("property_name"),
        }
        for row in response.data or []
    ]


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
    return _first_row(
        _editable(
            client.table("bills").select("*").eq("bill_id", str(bill_id)),
            user_id,
        )
    )


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

    `exclude_unset` keeps explicit nulls, so a field cleared in the form is
    cleared in the database, while fields the client did not send are left
    untouched. The match is worked out again when the request sends the
    account number or the vendor account, and on every save of a draft whose
    stored match was not picked, so an account or property added or changed
    since is taken into account; a value the request does not send is read
    from the stored draft. A picked account stays until the request changes
    the number or the pick; a new address on such a draft only flags it again.
    """
    payload = draft.model_dump(
        mode="json",
        exclude_unset=True,
        exclude=MATCH_FIELDS,
    )

    sent = draft.model_fields_set

    stored: dict | None = None
    if not {"account_number_raw", "property_address"} <= sent:
        stored = get_editable_draft(client, bill_id, user_id)

        if stored is None:
            return None

    def current(field: str) -> Any:
        if field in sent or stored is None:
            return getattr(draft, field)
        return stored.get(field)

    keeps_pick = (
        stored is not None
        and stored["vendor_account_picked"]
        and not sent & {"account_number_raw", "vendor_account_id"}
    )
    if not keeps_pick:
        payload |= match_columns(
            client,
            current("account_number_raw"),
            draft.vendor_account_id,
            current("property_address"),
        )
    elif "property_address" in sent and stored is not None:
        payload["property_address_mismatch"] = address_disagrees(
            client, draft.property_address, stored["property_id"]
        )

    if not payload:
        return stored

    response = _write(
        _editable(
            client.table("bills").update(payload).eq("bill_id", str(bill_id)),
            user_id,
        ).select(DRAFT_COLUMNS)
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
) -> BillRead:
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
    """
    payload = _rpc_fields(client, fields)

    response = _write(
        client.rpc(
            "submit_draft_bill_with_approval",
            {
                "p_bill_id": str(bill_id),
                "p_fields": payload,
                "p_user_id": str(user_id),
            },
        )
    )

    if response.data is None:
        raise RuntimeError("Draft submission did not return a bill ID.")

    submitted_bill_id = UUID(str(response.data))

    return _get_bill_by_id(
        client,
        submitted_bill_id,
    )

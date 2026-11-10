"""Reads and writes `public.vendors`.

The table names its columns `vendor_id` and `vendor_name`; the API calls them
`id` and `name` (`VendorRead`). The mapping lives here and nowhere else.
"""

from typing import Any
from uuid import UUID

from backend.schemas.vendor import VendorCreate, VendorUpdate
from supabase import Client

COLUMNS = (
    "vendor_id,vendor_name,contact_email,contact_phone,"
    "default_payment_method,created_at"
)


def _to_api(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["vendor_id"],
        "name": row["vendor_name"],
        "contact_email": row.get("contact_email"),
        "contact_phone": row.get("contact_phone"),
        "default_payment_method": row.get("default_payment_method"),
        "created_at": row["created_at"],
    }


def _to_db(fields: dict[str, Any]) -> dict[str, Any]:
    if "name" in fields:
        fields = {**fields, "vendor_name": fields["name"]}
        del fields["name"]
    return fields


def list_vendors(client: Client) -> list[dict[str, Any]]:
    response = client.table("vendors").select(COLUMNS).order("vendor_name").execute()

    return [_to_api(row) for row in response.data or []]


def get_vendor(client: Client, vendor_id: UUID) -> dict[str, Any] | None:
    response = (
        client.table("vendors")
        .select(COLUMNS)
        .eq("vendor_id", str(vendor_id))
        .maybe_single()
        .execute()
    )

    # maybe_single() returns None (not an empty result) when no row matches.
    row = response.data if response is not None else None

    return _to_api(row) if isinstance(row, dict) else None


def create_vendor(client: Client, vendor: VendorCreate) -> dict[str, Any]:
    payload = _to_db(vendor.model_dump(mode="json"))

    response = client.table("vendors").insert(payload).execute()

    return _to_api(response.data[0])


def update_vendor(
    client: Client,
    vendor_id: UUID,
    updates: VendorUpdate,
) -> dict[str, Any] | None:
    """Update the vendor; return None if no such vendor exists.

    `exclude_unset` keeps explicit nulls (clear the field) and leaves fields
    the client did not send untouched.
    """
    payload = _to_db(updates.model_dump(mode="json", exclude_unset=True))

    if not payload:
        return get_vendor(client, vendor_id)

    response = (
        client.table("vendors")
        .update(payload)
        .eq("vendor_id", str(vendor_id))
        .select(COLUMNS)
        .execute()
    )

    rows = response.data or []

    return _to_api(rows[0]) if len(rows) == 1 else None

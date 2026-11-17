"""Reads and writes `public.properties`.

The table names its key `property_id` and keeps the address in flat columns;
the API calls the key `id` and nests the address (`PropertyRead`). The
mapping lives here and nowhere else.
"""

import re
from typing import Any
from uuid import UUID

from postgrest.exceptions import APIError

from backend.schemas.property import PropertyCreate, PropertyUpdate
from supabase import Client

COLUMNS = "property_id,property_name,street,city,state,zip_code,status,created_at"

# PostgREST answers 416 with this code when the offset is past the last row.
RANGE_NOT_SATISFIABLE = "PGRST103"

# LIKE wildcards and its escape character, matched literally in a name search.
LIKE_SPECIAL = re.compile(r"([\\%_])")


def _to_api(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["property_id"],
        "property_name": row["property_name"],
        "address": {
            "street": row["street"],
            "city": row["city"],
            "state": row["state"],
            "zip_code": row["zip_code"],
        },
        "status": row["status"],
        "created_at": row["created_at"],
    }


def _name_pattern(name: str) -> str:
    # PostgREST also reads `*` as `%`; that one cannot be escaped.
    escaped = LIKE_SPECIAL.sub(r"\\\1", name)
    return f"%{escaped}%"


def list_properties(
    client: Client, *, name: str | None, skip: int, limit: int
) -> tuple[list[dict[str, Any]], int]:
    """One page of properties sorted by name, and the number that match.

    `name` keeps the properties whose name contains it, ignoring case.
    """

    def query(columns: str):
        builder = client.table("properties").select(columns, count="exact")
        return builder.ilike("property_name", _name_pattern(name)) if name else builder

    try:
        response = (
            query(COLUMNS)
            .order("property_name")
            .order("property_id")
            .range(skip, skip + limit - 1)
            .execute()
        )
    except APIError as error:
        if error.code != RANGE_NOT_SATISFIABLE:
            raise
        # A page past the end is empty, not an error; still say how many match.
        counted = query("property_id").limit(0).execute()
        return [], counted.count or 0

    return [_to_api(row) for row in response.data or []], response.count or 0


def create_property(client: Client, prop: PropertyCreate) -> dict[str, Any]:
    """Insert the property, its address flattened into the table's columns."""
    payload = {
        "property_name": prop.property_name,
        **prop.address.model_dump(),
        "status": prop.status,
    }
    response = client.table("properties").insert(payload).execute()

    return _to_api(response.data[0])


def get_property(client: Client, property_id: UUID) -> dict[str, Any] | None:
    """The property, or None if there is no such property."""
    response = (
        client.table("properties")
        .select(COLUMNS)
        .eq("property_id", str(property_id))
        .maybe_single()
        .execute()
    )
    row = response.data if response is not None else None
    return _to_api(row) if isinstance(row, dict) else None


def update_property(
    client: Client, property_id: UUID, updates: PropertyUpdate
) -> dict[str, Any] | None:
    """Change the fields sent, the address flattened into its columns; return
    the property, or None if there is no such property."""
    changes = updates.model_dump(exclude_unset=True)
    payload = {**changes.pop("address", {}), **changes}

    response = (
        client.table("properties")
        .update(payload)
        .eq("property_id", str(property_id))
        .select(COLUMNS)
        .execute()
    )
    rows = response.data or []
    return _to_api(rows[0]) if len(rows) == 1 else None


ADDRESS_COLUMNS = "property_id,street,zip_code"


def list_active_property_addresses(client: Client) -> list[dict[str, Any]]:
    """The id, street and ZIP of every active property, for property_matching."""
    response = (
        client.table("properties")
        .select(ADDRESS_COLUMNS)
        .eq("status", "active")
        .execute()
    )
    return list(response.data or [])


def get_property_address(client: Client, property_id: str) -> dict[str, Any] | None:
    """The id, street and ZIP of one property, active or not."""
    response = (
        client.table("properties")
        .select(ADDRESS_COLUMNS)
        .eq("property_id", property_id)
        .maybe_single()
        .execute()
    )
    row = response.data if response is not None else None
    return row if isinstance(row, dict) else None

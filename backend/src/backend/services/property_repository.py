"""Reads `public.properties`.

The table names its key `property_id` and keeps the address in flat columns;
the API calls the key `id` and nests the address (`PropertyRead`). The
mapping lives here and nowhere else.
"""

import re
from typing import Any

from postgrest.exceptions import APIError

from supabase import Client

COLUMNS = "property_id,property_name,street,city,state,zip_code,status"

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

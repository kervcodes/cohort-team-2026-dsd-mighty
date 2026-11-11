"""The audit event schemas match public.audit_events, read from a running database.

`AuditEventRead` and `AuditEventCreate` once said performed_by / timestamp / id
where the table says user_id / occurred_at / event_id, and required a
new_status the table allows to be null. Two hand-written lists (one in a
test, one in a migration check) never met, so nothing caught it. This asks the
database for its columns and compares them with the models' own fields.

Opt in with DATABASE_URL pointing at a database with the migrations applied:
`scripts/test-db.sh -- uv run pytest tests/test_audit_event_schema.py`, or, in
CI, the `database` job. The queries only read.
"""

import os
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row
from pydantic import TypeAdapter, ValidationError
from pydantic.fields import FieldInfo

from backend.schemas.audit_event import AuditEventCreate, AuditEventRead

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="set DATABASE_URL to a migrated database to compare audit_events with "
    "the schemas",
)


@pytest.fixture(scope="module")
def columns() -> Iterator[dict[str, dict[str, Any]]]:
    """Column name -> {nullable, has_default} of public.audit_events."""
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as db:
        rows = db.execute(
            "select column_name, is_nullable = 'YES' as nullable, "
            "column_default is not null as has_default "
            "from information_schema.columns "
            "where table_schema = 'public' and table_name = 'audit_events'"
        ).fetchall()
    assert rows, "public.audit_events not found: are the migrations applied?"
    yield {row["column_name"]: row for row in rows}


def accepts_none(field: FieldInfo) -> bool:
    try:
        TypeAdapter(field.annotation).validate_python(None)
    except ValidationError:
        return False
    return True


def test_a_read_has_exactly_the_columns_of_the_table(columns):
    assert set(AuditEventRead.model_fields) == set(columns)


def test_a_read_allows_none_exactly_where_the_column_is_nullable(columns):
    nullable = {name for name, col in columns.items() if col["nullable"]}
    allows_none = {
        name
        for name, field in AuditEventRead.model_fields.items()
        if accepts_none(field)
    }

    assert allows_none == nullable


def test_a_create_names_only_columns_and_every_required_column(columns):
    # What the caller must supply: not null, and no default to fall back on.
    required = {
        name
        for name, col in columns.items()
        if not col["nullable"] and not col["has_default"]
    }
    fields = AuditEventCreate.model_fields

    assert set(fields) <= set(columns)
    assert required <= set(fields)


def test_a_create_allows_none_only_where_the_column_is_nullable(columns):
    wrongly_optional = [
        name
        for name, field in AuditEventCreate.model_fields.items()
        if name in columns and accepts_none(field) and not columns[name]["nullable"]
    ]

    assert wrongly_optional == []

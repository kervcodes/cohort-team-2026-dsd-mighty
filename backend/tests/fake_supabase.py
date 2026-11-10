"""In-memory stand-in for the supabase-py client, for route tests.

It applies `.eq()` / `.is_()` / `.or_()` filters the way PostgREST does, so
tests run the real repository queries. That is what lets a test prove that
the rules in `bill_access` keep one analyst out of another's drafts: the
routes use the service-role client, which bypasses row-level security, so
those filters are the only guard.

`select()` resolves embeds such as `submitter:app_users!submitted_by(...)`
through FOREIGN_KEYS, and an insert must satisfy those foreign keys, as in
Postgres. Plain columns are not projected: every stored column comes back.

Supports only the query shapes the repository uses. Helpers, not tests.
"""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

# (table, column) -> (referenced table, referenced column), as in the migrations.
FOREIGN_KEYS = {("bills", "submitted_by"): ("app_users", "user_id")}

# alias:table!fk_column(col,col)
EMBED = re.compile(r"(\w+):(\w+)!(\w+)\(([\w,]+)\)")

# The PostgREST operators `or_` accepts here: column.operator.value
OPERATORS: dict[str, Callable[[Any, str], bool]] = {
    "eq": lambda stored, value: stored is not None and str(stored) == value,
    # SQL: NULL <> 'x' is not true, so a null never matches neq either.
    "neq": lambda stored, value: stored is not None and str(stored) != value,
}


class _Result:
    def __init__(self, data: Any) -> None:
        self.data = data


def _insert_defaults(table: str) -> dict[str, Any]:
    """The column defaults Postgres fills in on insert, per table."""
    now = datetime.now(UTC).isoformat()
    if table == "vendors":
        return {"vendor_id": str(uuid4()), "created_at": now}
    return {"bill_id": str(uuid4()), "document_path": None, "created_at": now}


class _Query:
    def __init__(self, db: "FakeSupabase", table: str) -> None:
        self._db = db
        self._table = table
        self._rows = db.tables.setdefault(table, [])
        self._op = "select"
        self._payload: dict[str, Any] | None = None
        self._filters: list[tuple[str, Any]] = []
        self._any_of: list[list[tuple[str, str, str]]] = []
        self._embeds: list[tuple[str, str, str, list[str]]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None
        self._single: str | None = None  # "maybe" or "one"

    def select(self, *columns: str) -> "_Query":
        # After insert/update this names the columns of the affected rows.
        for alias, table, fk_column, inner in EMBED.findall(",".join(columns)):
            self._embeds.append((alias, table, fk_column, inner.split(",")))
        return self

    def insert(self, payload: dict[str, Any]) -> "_Query":
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload: dict[str, Any]) -> "_Query":
        self._op, self._payload = "update", payload
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self._filters.append((column, value))
        return self

    def or_(self, filters: str) -> "_Query":
        conditions = []
        for condition in filters.split(","):
            column, operator, value = condition.split(".", 2)
            assert operator in OPERATORS, f"or_ operator {operator!r} unsupported"
            conditions.append((column, operator, value))
        self._any_of.append(conditions)
        return self

    def is_(self, column: str, value: str) -> "_Query":
        assert value == "null", "only is_(column, 'null') is supported"
        self._filters.append((column, None))
        return self

    def order(self, column: str, desc: bool = False) -> "_Query":
        self._order = (column, desc)
        return self

    def limit(self, count: int) -> "_Query":
        self._limit = count
        return self

    def maybe_single(self) -> "_Query":
        self._single = "maybe"
        return self

    def single(self) -> "_Query":
        self._single = "one"
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return all(row.get(column) == value for column, value in self._filters) and all(
            any(OPERATORS[op](row.get(column), value) for column, op, value in group)
            for group in self._any_of
        )

    def _embed(self, row: dict[str, Any]) -> dict[str, Any]:
        for alias, table, fk_column, inner in self._embeds:
            target, key = FOREIGN_KEYS[(self._table, fk_column)]
            assert target == table, f"{fk_column} references {target}, not {table}"
            match = self._db.find(table, key, row.get(fk_column))
            row[alias] = {c: match.get(c) for c in inner} if match else None
        return row

    def _check_foreign_keys(self, row: dict[str, Any]) -> None:
        for (table, column), (target, key) in FOREIGN_KEYS.items():
            value = row.get(column)
            if table == self._table and value is not None:
                assert self._db.find(target, key, value), (
                    f"insert violates foreign key {table}.{column} -> {target}"
                )

    def execute(self) -> _Result | None:
        if self._op == "insert":
            row = {**_insert_defaults(self._table), **(self._payload or {})}
            self._check_foreign_keys(row)
            self._rows.append(row)
            rows = [row]
        else:
            rows = [row for row in self._rows if self._matches(row)]
            if self._op == "update":
                for row in rows:
                    row.update(self._payload or {})
            if self._order:
                column, desc = self._order
                rows.sort(key=lambda row: row.get(column) or "", reverse=desc)
            if self._limit is not None:
                rows = rows[: self._limit]

        copies = [self._embed(dict(row)) for row in rows]
        if self._single == "maybe":
            # supabase-py returns None, not an empty result, for no match.
            return _Result(copies[0]) if copies else None
        if self._single == "one":
            assert len(copies) == 1, f"single() matched {len(copies)} rows"
            return _Result(copies[0])
        return _Result(copies)


class _Bucket:
    def __init__(self, storage: "_Storage") -> None:
        self._storage = storage

    def upload(self, path: str, file: bytes, file_options: Any = None) -> None:
        if self._storage.fail_uploads:
            raise RuntimeError("storage unavailable")
        self._storage.objects[path] = file

    def remove(self, paths: list[str]) -> None:
        for path in paths:
            self._storage.objects.pop(path, None)
            self._storage.removed.append(path)


class _Storage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.removed: list[str] = []
        self.fail_uploads = False

    def from_(self, _bucket: str) -> _Bucket:
        return _Bucket(self)


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.storage = _Storage()

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def find(self, table: str, column: str, value: Any) -> dict[str, Any] | None:
        rows = self.tables.get(table, [])
        return next((row for row in rows if row.get(column) == value), None)

    def add_user(self, user_id: str, full_name: str = "Test User") -> dict[str, Any]:
        row = {"user_id": user_id, "full_name": full_name}
        self.tables.setdefault("app_users", []).append(row)
        return row

    def add_bill(self, submitted_by: str, **fields: Any) -> dict[str, Any]:
        """A bill row; its submitter's `app_users` row is added if missing, as
        the foreign key needs it."""
        if not self.find("app_users", "user_id", submitted_by):
            self.add_user(submitted_by)
        row = {
            "bill_id": str(uuid4()),
            "submitted_by": submitted_by,
            "status": "draft",
            "document_path": None,
            "created_at": datetime.now(UTC).isoformat(),
            **fields,
        }
        self.tables.setdefault("bills", []).append(row)
        return row

    def add_vendor(self, vendor_name: str, **fields: Any) -> dict[str, Any]:
        row = {
            "vendor_id": str(uuid4()),
            "vendor_name": vendor_name,
            "contact_email": None,
            "contact_phone": None,
            "default_payment_method": None,
            "created_at": datetime.now(UTC).isoformat(),
            **fields,
        }
        self.table("vendors")._rows.append(row)
        return row

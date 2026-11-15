"""In-memory stand-in for the supabase-py client, for route tests.

It applies `.eq()` / `.is_()` / `.or_()` filters the way PostgREST does, so
tests run the real repository queries. That is what lets a test prove that
the rules in `bill_access` keep one analyst out of another's drafts: the
routes use the service-role client, which bypasses row-level security, so
those filters are the only guard.

`select()` resolves embeds such as `submitter:app_users!submitted_by(...)`
through FOREIGN_KEYS. Inserts and updates must satisfy FOREIGN_KEYS and
UNIQUE_KEYS; a violation raises the `APIError` PostgREST sends, with the
Postgres error code, so the repositories' error handling runs in tests.

`rpc()` runs Python twins of the SQL functions the repositories call (see
FakeRpc), with Vault as a dict of plaintext secrets.

`rpc()` runs Python twins of the Postgres functions in RPCS; each mirrors its
migration, including the SQLSTATE and DETAIL of every refusal.

Supports only the query shapes the repository uses. Helpers, not tests.
"""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from postgrest.exceptions import APIError

# (table, column) -> (referenced table, referenced column), as in the migrations.
FOREIGN_KEYS = {
    ("bills", "submitted_by"): ("app_users", "user_id"),
    ("vendor_accounts", "property_id"): ("properties", "property_id"),
    ("vendor_accounts", "vendor_id"): ("vendors", "vendor_id"),
}

# table -> column sets that must be unique together, as in the migrations.
UNIQUE_KEYS = {
    "vendor_accounts": [("property_id", "vendor_id", "account_number")],
}

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
    if table == "vendor_accounts":
        return {
            "account_id": str(uuid4()),
            "portal_url": None,
            "portal_login_email": None,
            "portal_password_secret_id": None,
            "status": "active",
            "created_at": now,
        }
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
        self._columns: list[str] | None = None  # None: every column
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None
        self._single: str | None = None  # "maybe" or "one"
        self._neq_filters: list[tuple[str, Any]] = []

    def select(self, *columns: str) -> "_Query":
        # After insert/update this names the columns of the affected rows.
        # Like PostgREST, only the named columns come back ("*" is all), so a
        # query that forgets a column fails in tests too.
        joined = ",".join(columns)
        for alias, table, fk_column, inner in EMBED.findall(joined):
            self._embeds.append((alias, table, fk_column, inner.split(",")))
        plain = [c.strip() for c in EMBED.sub("", joined).split(",") if c.strip()]
        self._columns = None if "*" in plain else plain
        return self

    def insert(self, payload: dict[str, Any]) -> "_Query":
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload: dict[str, Any]) -> "_Query":
        self._op, self._payload = "update", payload
        return self

    def delete(self) -> "_Query":
        self._op = "delete"
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

    def neq(self, column: str, value: Any) -> "_Query":
        self._neq_filters.append((column, value))
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return (
            all(row.get(column) == value for column, value in self._filters)
            and all(row.get(column) != value for column, value in self._neq_filters)
            and all(
                any(
                    OPERATORS[op](row.get(column), value) for column, op, value in group
                )
                for group in self._any_of
            )
        )

    def _embed(self, row: dict[str, Any]) -> dict[str, Any]:
        for alias, table, fk_column, inner in self._embeds:
            target, key = FOREIGN_KEYS[(self._table, fk_column)]
            assert target == table, f"{fk_column} references {target}, not {table}"
            match = self._db.find(table, key, row.get(fk_column))
            row[alias] = {c: match.get(c) for c in inner} if match else None
        return row

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._columns is None:
            return row
        keep = set(self._columns) | {alias for alias, *_ in self._embeds}
        return {column: value for column, value in row.items() if column in keep}

    def _check_constraints(self, row: dict[str, Any], others: list[dict]) -> None:
        for (table, column), (target, key) in FOREIGN_KEYS.items():
            value = row.get(column)
            if table == self._table and value is not None:
                if not self._db.find(target, key, value):
                    raise APIError(
                        {
                            "code": "23503",
                            "message": f"{table}.{column} violates foreign key",
                        }
                    )
        for columns in UNIQUE_KEYS.get(self._table, []):
            key = tuple(row.get(column) for column in columns)
            if any(tuple(other.get(c) for c in columns) == key for other in others):
                raise APIError(
                    {
                        "code": "23505",
                        "message": f"duplicate key on {self._table} {columns}",
                    }
                )

    def execute(self) -> _Result | None:
        if self._op == "insert":
            row = {**_insert_defaults(self._table), **(self._payload or {})}
            self._check_constraints(row, self._rows)
            self._rows.append(row)
            rows = [row]
        else:
            rows = [row for row in self._rows if self._matches(row)]
            if self._op == "update":
                # Check every row first: a failed statement changes nothing.
                for row in rows:
                    updated = {**row, **(self._payload or {})}
                    others = [other for other in self._rows if other is not row]
                    self._check_constraints(updated, others)
                for row in rows:
                    row.update(self._payload or {})
            if self._op == "delete":
                for row in rows:
                    self._rows.remove(row)
                    self._db.after_delete(self._table, row)
            if self._order:
                column, desc = self._order
                rows.sort(key=lambda row: row.get(column) or "", reverse=desc)
            if self._limit is not None:
                rows = rows[: self._limit]

        copies = [self._project(self._embed(dict(row))) for row in rows]
        if self._single == "maybe":
            # supabase-py returns None, not an empty result, for no match.
            return _Result(copies[0]) if copies else None
        if self._single == "one":
            assert len(copies) == 1, f"single() matched {len(copies)} rows"
            return _Result(copies[0])
        return _Result(copies)


def _refuse(code: str, message: str, details: str | None = None) -> APIError:
    return APIError({"code": code, "message": message, "details": details})


def _record_payment(db: "FakeSupabase", params: dict[str, Any]) -> dict[str, Any]:
    """Migration 20261115120000_record_payment, without the row lock: the fake
    runs one call at a time, which is what the lock gives Postgres."""
    bill_id = params["p_bill_id"]
    payment_status = params["p_payment_status"]
    if payment_status not in ("completed", "failed"):
        raise _refuse("22023", f"payment_status {payment_status!r} not allowed")

    bill = db.find("bills", "bill_id", bill_id)
    if bill is None:
        raise _refuse("PT404", f"Bill {bill_id} not found")
    if bill["status"] != "approved":
        raise _refuse("PT409", f"Bill {bill_id} is not approved", bill["status"])

    bill_amount = Decimal(str(bill["amount"]))
    if payment_status == "completed" and Decimal(params["p_amount"]) != bill_amount:
        raise _refuse("PT422", "Amount does not match", f"{bill_amount:.2f}")

    # payments_failure_reason_only_when_failed
    if (payment_status == "failed") != (params["p_failure_reason"] is not None):
        raise _refuse("23514", "payments_failure_reason_only_when_failed")

    # payments.recorded_by references app_users
    if db.find("app_users", "user_id", params["p_recorded_by"]) is None:
        raise _refuse("23503", "payments_recorded_by_fkey")

    payments = db.tables.setdefault("payments", [])
    attempts = [p["attempt_number"] for p in payments if p["bill_id"] == bill_id]
    now = datetime.now(UTC).isoformat()
    row = {
        "payment_id": str(uuid4()),
        "bill_id": bill_id,
        "payment_method": params["p_payment_method"],
        "amount": params["p_amount"],
        "paid_on": params["p_paid_on"],
        "attempt_number": max(attempts, default=0) + 1,
        "payment_status": payment_status,
        "gateway_status": None,
        "provider_reference": params["p_provider_reference"],
        "failure_reason": params["p_failure_reason"],
        "recorded_by": params["p_recorded_by"],
        "created_at": now,
        "updated_at": now,
    }
    payments.append(row)

    if payment_status == "completed":
        bill["status"] = "paid"

    return dict(row)


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


class _Rpc:
    def __init__(self, db: "FakeSupabase", name: str, params: dict[str, Any]) -> None:
        self._db = db
        self._name = name
        self._params = params

    def execute(self) -> _Result:
        if self._db.fail_rpcs:
            raise APIError({"code": "08006", "message": "connection failure"})
        self._db.rpc_calls.append(self._name)
        function = getattr(self._db, f"_rpc_{self._name}")
        return _Result(function(**self._params))


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.storage = _Storage()
        # Vault: secret id -> plaintext. The real one stores ciphertext.
        self.vault: dict[str, str] = {}
        self.rpc_calls: list[str] = []
        self.fail_rpcs = False

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def rpc(self, name: str, params: dict[str, Any]) -> _Rpc:
        return _Rpc(self, name, params)

    def after_delete(self, table: str, row: dict[str, Any]) -> None:
        # Trigger vendor_accounts_delete_portal_password.
        if table == "vendor_accounts" and row["portal_password_secret_id"]:
            self.vault.pop(row["portal_password_secret_id"], None)

    def _rpc_record_payment(self, **params: Any) -> dict[str, Any]:
        return _record_payment(self, params)

    # Python twins of the SQL functions in
    # 20261115100000_vendor_portal_login.sql. Keep them in step.

    def _locked_account(self, account_id: str) -> dict[str, Any]:
        account = self.find("vendor_accounts", "account_id", account_id)
        if account is None:
            raise APIError(
                {"code": "P0002", "message": f"vendor account {account_id} not found"}
            )
        return account

    def _rpc_set_vendor_account_portal_password(
        self, p_account_id: str, p_password: str
    ) -> None:
        if not p_password:
            raise APIError(
                {"code": "22023", "message": "portal password must not be empty"}
            )
        account = self._locked_account(p_account_id)
        secret_id = account["portal_password_secret_id"]
        if secret_id is None:
            secret_id = str(uuid4())
            account["portal_password_secret_id"] = secret_id
        self.vault[secret_id] = p_password

    def _rpc_clear_vendor_account_portal_password(self, p_account_id: str) -> None:
        account = self._locked_account(p_account_id)
        secret_id = account["portal_password_secret_id"]
        if secret_id is not None:
            # Deleting the secret nulls the id (on delete set null).
            del self.vault[secret_id]
            account["portal_password_secret_id"] = None

    def _rpc_get_vendor_account_portal_login(
        self, p_account_id: str
    ) -> list[dict[str, Any]]:
        account = self.find("vendor_accounts", "account_id", p_account_id)
        if account is None:
            return []
        secret_id = account["portal_password_secret_id"]
        return [
            {
                "portal_url": account["portal_url"],
                "portal_login_email": account["portal_login_email"],
                "portal_password": self.vault.get(secret_id) if secret_id else None,
            }
        ]

    def find(self, table: str, column: str, value: Any) -> dict[str, Any] | None:
        rows = self.tables.get(table, [])
        return next((row for row in rows if row.get(column) == value), None)

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

    def add_property(self, property_name: str = "Elm Court", **fields: Any) -> dict:
        row = {
            "property_id": str(uuid4()),
            "property_name": property_name,
            "street": "1 Main St",
            "city": "Dallas",
            "state": "TX",
            "zip_code": "75201",
            "status": "active",
            "created_at": datetime.now(UTC).isoformat(),
            **fields,
        }
        self.table("properties")._rows.append(row)
        return row

    def add_vendor_account(
        self, property_id: str, vendor_id: str, **fields: Any
    ) -> dict[str, Any]:
        """An account row; set its password with `rpc`, as the repository does."""
        row = {
            **_insert_defaults("vendor_accounts"),
            "property_id": property_id,
            "vendor_id": vendor_id,
            "account_number": "ACC-1",
            "account_type": "water",
            "payment_method": "ach",
            **fields,
        }
        self.table("vendor_accounts")._rows.append(row)
        return row

    def add_user(
        self,
        user_id: str,
        **fields: Any,
    ) -> dict[str, Any]:
        row = {
            "user_id": user_id,
            "full_name": "Test User",
            "email": "test@example.com",
            "role": "analyst",
            "status": "active",
            "created_at": datetime.now(UTC).isoformat(),
            **fields,
        }
        self.table("app_users")._rows.append(row)
        return row

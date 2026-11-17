"""In-memory stand-in for the supabase-py client, for route tests.

It applies the query filters used by the repositories so tests exercise the
real repository queries. This matters because the routes use a service-role
client, which bypasses row-level security: bill_access filters are the
authorization boundary for bill reads and writes.

select() resolves embeds such as submitter:app_users!submitted_by(...)
through FOREIGN_KEYS. Inserts and updates must satisfy FOREIGN_KEYS and
UNIQUE_KEYS; a violation raises the APIError PostgREST sends, with the
Postgres error code, so the repositories' error handling runs in tests.

`rpc()` runs Python twins of the Postgres functions, the `FakeSupabase._rpc_*`
methods (`_record_payment` for record_payment), with Vault as a dict of
plaintext secrets; each mirrors its migration, including the SQLSTATE and
DETAIL of every refusal. Each call is one transaction, as through PostgREST:
if the twin raises, every table row and Vault secret it changed is put back.

Supports only the query shapes the repositories use. Helpers, not tests.
"""

import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

from postgrest.exceptions import APIError

from backend.services.vendor_account_matching import same_account_number

# (table, column) -> (referenced table, referenced column)
FOREIGN_KEYS = {
    ("bills", "submitted_by"): ("app_users", "user_id"),
    ("bills", "vendor_account_id"): ("vendor_accounts", "account_id"),
    ("bills", "vendor_id"): ("vendors", "vendor_id"),
    ("bills", "property_id"): ("properties", "property_id"),
    ("approvals", "reviewer_id"): ("app_users", "user_id"),
    ("vendor_accounts", "property_id"): ("properties", "property_id"),
    ("vendor_accounts", "vendor_id"): ("vendors", "vendor_id"),
    ("payment_runs", "bill_id"): ("bills", "bill_id"),
    ("payment_runs", "started_by"): ("app_users", "user_id"),
}


def _columns_key(*columns: str) -> Callable[[dict[str, Any]], tuple | None]:
    def key(row: dict[str, Any]) -> tuple | None:
        values = tuple(row.get(column) for column in columns)
        # PostgreSQL: NULL in any indexed value never conflicts.
        return None if None in values else values

    return key


def _bill_invoice_key(row: dict[str, Any]) -> tuple | None:
    # bills_account_invoice_unique:
    # (vendor_account_id, lower(btrim(invoice_number)))
    # where vendor_account_id is not null.
    account = row.get("vendor_account_id")
    invoice = row.get("invoice_number")

    if account is None or invoice is None:
        return None

    return account, invoice.strip(" ").lower()


UNIQUE_KEYS: dict[str, list[Callable[[dict[str, Any]], tuple | None]]] = {
    "vendor_accounts": [_columns_key("property_id", "vendor_id", "account_number")],
    "bills": [_bill_invoice_key],
}

# table -> (columns, row predicate): unique among the rows the predicate
# holds for, like a partial unique index.
PARTIAL_UNIQUE_KEYS: dict[str, list[tuple[tuple[str, ...], Callable[..., bool]]]] = {
    # payment_runs_one_active_per_bill
    "payment_runs": [
        (("bill_id",), lambda row: row.get("status") in ("queued", "running"))
    ],
}

FINAL_RUN_STATUSES = ("paid", "flagged", "failed")

# table -> (constraint name, predicate every row must satisfy), as in the
# migrations' check constraints.
CHECKS: dict[str, list[tuple[str, Callable[[dict[str, Any]], bool]]]] = {
    "payment_runs": [
        (
            "payment_runs_status_check",
            lambda r: r["status"] in ("queued", "running", *FINAL_RUN_STATUSES),
        ),
        (
            "payment_runs_steps_check",
            lambda r: isinstance(r["steps"], list),
        ),
        (
            "payment_runs_flag_reason_only_when_flagged",
            lambda r: (r["status"] == "flagged") == (r["flag_reason"] is not None),
        ),
        (
            "payment_runs_started_unless_queued",
            lambda r: (r["status"] == "queued") == (r["started_at"] is None),
        ),
        (
            "payment_runs_finished_when_done",
            lambda r: (
                (r["status"] in FINAL_RUN_STATUSES) == (r["finished_at"] is not None)
            ),
        ),
        (
            "payment_runs_payment_when_recorded",
            lambda r: (
                r["status"] not in ("paid", "failed") or r["payment_id"] is not None
            ),
        ),
    ],
}

# alias:table!fk_column(col,col)
EMBED = re.compile(r"(\w+):(\w+)!(\w+)\(([\w,]+)\)")

OPERATORS: dict[str, Callable[[Any, str], bool]] = {
    "eq": lambda stored, value: stored is not None and str(stored) == value,
    # SQL NULL <> 'x' is not true.
    "neq": lambda stored, value: stored is not None and str(stored) != value,
}


def _sql_error(message: str, code: str) -> APIError:
    """Build the PostgREST error returned by a PostgreSQL exception."""
    return APIError(
        {
            "message": message,
            "code": code,
            "hint": None,
            "details": None,
        }
    )


class _Result:
    def __init__(self, data: Any, count: int | None = None) -> None:
        self.data = data
        # Set only when the query asked for count="exact", as in supabase-py.
        self.count = count


def _like_regex(pattern: str) -> re.Pattern[str]:
    """A Postgres LIKE pattern as a regex: `%` and PostgREST's `*` match any
    run, `_` one character, and a backslash escapes the next character."""
    parts = []
    characters = iter(pattern)

    for character in characters:
        if character == "\\":
            parts.append(re.escape(next(characters, "")))
        elif character in "%*":
            parts.append(".*")
        elif character == "_":
            parts.append(".")
        else:
            parts.append(re.escape(character))

    return re.compile("".join(parts), re.IGNORECASE | re.DOTALL)


def _insert_defaults(table: str) -> dict[str, Any]:
    """Return the defaults PostgreSQL supplies for supported tables."""
    now = datetime.now(UTC).isoformat()

    if table == "vendors":
        return {
            "vendor_id": str(uuid4()),
            "created_at": now,
        }

    if table == "approvals":
        return {
            "approval_id": str(uuid4()),
            "reviewer_id": None,
            "requested_at": now,
            "decision_at": None,
            "comments": None,
            "approval_status": "pending",
            "created_at": now,
            "updated_at": now,
        }

    if table == "vendor_accounts":
        return {
            "account_id": str(uuid4()),
            "portal_url": None,
            "portal_login_email": None,
            "portal_password_secret_id": None,
            "status": "active",
            "created_at": now,
        }

    if table == "bills":
        return {
            "bill_id": str(uuid4()),
            "document_path": None,
            "vendor_account_picked": False,
            "created_at": now,
        }

    if table == "payment_runs":
        return {
            "run_id": str(uuid4()),
            "status": "queued",
            "steps": [],
            "flag_reason": None,
            "receipt": None,
            "payment_id": None,
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "updated_at": now,
        }

    raise ValueError(f"Insert defaults are not defined for table {table!r}")


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
        self._order: list[tuple[str, bool]] = []
        self._limit: int | None = None
        self._offset = 0
        self._count = False
        self._likes: list[tuple[str, re.Pattern[str]]] = []
        self._single: str | None = None  # "maybe" or "one"
        self._neq_filters: list[tuple[str, Any]] = []

    def select(
        self,
        *columns: str,
        count: str | None = None,
    ) -> "_Query":
        """Select columns, including supported foreign-key embeds."""
        joined = ",".join(columns)

        for alias, table, fk_column, inner in EMBED.findall(joined):
            self._embeds.append((alias, table, fk_column, inner.split(",")))

        plain = [
            column.strip()
            for column in EMBED.sub("", joined).split(",")
            if column.strip()
        ]

        self._columns = None if "*" in plain else plain
        assert count in (None, "exact"), f"count={count!r} unsupported"
        self._count = count == "exact"
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
        self._order.append((column, desc))
        return self

    def limit(self, count: int) -> "_Query":
        self._limit = count
        return self

    def range(self, start: int, end: int) -> "_Query":
        # supabase-py sends offset and limit, as here.
        self._offset = start
        self._limit = end - start + 1
        return self

    def ilike(self, column: str, pattern: str) -> "_Query":
        self._likes.append((column, _like_regex(pattern)))
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
                isinstance(row.get(column), str)
                and pattern.fullmatch(row[column]) is not None
                for column, pattern in self._likes
            )
            and all(
                any(
                    OPERATORS[operator](row.get(column), value)
                    for column, operator, value in group
                )
                for group in self._any_of
            )
        )

    def _embed(self, row: dict[str, Any]) -> dict[str, Any]:
        for alias, table, fk_column, inner in self._embeds:
            target, key = FOREIGN_KEYS[(self._table, fk_column)]
            assert target == table, f"{fk_column} references {target}, not {table}"

            match = self._db.find(
                table,
                key,
                row.get(fk_column),
            )

            row[alias] = (
                {column: match.get(column) for column in inner} if match else None
            )

        return row

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._columns is None:
            return row

        keep = set(self._columns) | {alias for alias, *_ in self._embeds}

        return {column: value for column, value in row.items() if column in keep}

    def _check_constraints(
        self,
        row: dict[str, Any],
        others: list[dict[str, Any]],
    ) -> None:
        for (table, column), (target, key) in FOREIGN_KEYS.items():
            value = row.get(column)

            if table == self._table and value is not None:
                if self._db.find(target, key, value) is None:
                    raise APIError(
                        {
                            "code": "23503",
                            "message": f"{table}.{column} violates foreign key",
                        }
                    )
        for name, holds in CHECKS.get(self._table, []):
            if not holds(row):
                raise APIError({"code": "23514", "message": f"violates {name}"})
        for columns, applies in PARTIAL_UNIQUE_KEYS.get(self._table, []):
            key = tuple(row.get(column) for column in columns)
            if applies(row) and any(
                applies(other) and tuple(other.get(c) for c in columns) == key
                for other in others
            ):
                raise APIError(
                    {
                        "code": "23505",
                        "message": f"duplicate key on {self._table} {columns}",
                    }
                )
        for unique_key in UNIQUE_KEYS.get(self._table, []):
            key = unique_key(row)

            if key is not None and any(unique_key(other) == key for other in others):
                raise APIError(
                    {
                        "code": "23505",
                        "message": f"duplicate key on {self._table} {key}",
                    }
                )

    def execute(self) -> _Result | None:
        if self._op == "insert":
            row = {
                **_insert_defaults(self._table),
                **(self._payload or {}),
            }
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

            for column, desc in reversed(self._order):
                rows.sort(
                    key=lambda row: row.get(column) or "",
                    reverse=desc,
                )

            if self._count and self._offset > len(rows):
                # PostgREST answers 416 when a counted page starts past the end.
                raise APIError(
                    {
                        "code": "PGRST103",
                        "message": "Requested range not satisfiable",
                    }
                )

        total = len(rows)

        if self._op != "insert":
            end = None if self._limit is None else self._offset + self._limit
            rows = rows[self._offset : end]

        copies = [self._project(self._embed(dict(row))) for row in rows]

        if self._single == "maybe":
            return _Result(copies[0]) if copies else None

        if self._single == "one":
            assert len(copies) == 1, f"single() matched {len(copies)} rows"
            return _Result(copies[0])

        return _Result(
            copies,
            total if self._count else None,
        )


def _refuse(code: str, message: str, details: str | None = None) -> APIError:
    return APIError({"code": code, "message": message, "details": details})


def _decimal_or_none(value: Any) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _record_payment(db: "FakeSupabase", params: dict[str, Any]) -> dict[str, Any]:
    """Migration 20261117100000_record_payment, without the row lock: the fake
    runs one call at a time, which is what the lock gives Postgres."""
    bill_id = params["p_bill_id"]
    payment_status = params["p_payment_status"]
    if payment_status not in ("completed", "failed"):
        raise _refuse("22023", f"payment_status {payment_status!r} not allowed")

    bill = db.find("bills", "bill_id", bill_id)
    if bill is None:
        raise _refuse("PT404", f"Bill {bill_id} not found")

    # `is distinct from`: None never equals a value but does equal None, and
    # a null DETAIL comes back empty.
    bill_status = bill["status"]
    if bill_status != "approved":
        detail = "" if bill_status is None else bill_status
        raise _refuse("PT409", f"Bill {bill_id} is not approved", detail)

    bill_amount = _decimal_or_none(bill["amount"])
    amount = _decimal_or_none(params["p_amount"])
    if payment_status == "completed" and amount != bill_amount:
        detail = "" if bill_amount is None else f"{bill_amount:.2f}"
        raise _refuse("PT422", "Amount does not match", detail)

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

    def upload(
        self,
        path: str,
        file: bytes,
        file_options: Any = None,
    ) -> None:
        if self._storage.fail_uploads:
            raise RuntimeError("storage unavailable")

        self._storage.objects[path] = file

    def remove(self, paths: list[str]) -> None:
        for path in paths:
            self._storage.objects.pop(path, None)
            self._storage.removed.append(path)

    def create_signed_url(
        self,
        path: str,
        expires_in: int = 300,
    ) -> dict[str, str]:
        if path not in self._storage.objects:
            raise FileNotFoundError(f"Storage object not found: {path}")

        return {
            "signedURL": (
                f"https://test-storage.example/invoices/{path}"
                f"?token=test-token&expires_in={expires_in}"
            )
        }


class _Storage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.removed: list[str] = []
        self.fail_uploads = False

    def from_(self, _bucket: str) -> _Bucket:
        return _Bucket(self)


class _Rpc:
    def __init__(
        self,
        db: "FakeSupabase",
        name: str,
        params: dict[str, Any],
    ) -> None:
        self._db = db
        self._name = name
        self._params = params

    def execute(self) -> _Result:
        self._db.rpc_calls.append(self._name)
        function = getattr(self._db, f"_rpc_{self._name}")

        with self._db.transaction():
            return _Result(function(**self._params))


# Columns the account functions accept, as in the SQL functions' allow-lists.
ACCOUNT_UPDATE_FIELDS = (
    "account_number",
    "account_type",
    "payment_method",
    "portal_url",
    "portal_login_email",
    "status",
)
ACCOUNT_CREATE_FIELDS = (
    "property_id",
    "vendor_id",
    *ACCOUNT_UPDATE_FIELDS,
)


# Bill fields accepted by the approval workflow RPC twins.
APPROVAL_BILL_FIELDS = (
    "account_number_raw",
    "vendor_name_raw",
    "invoice_number",
    "invoice_date",
    "due_date",
    "amount",
    "prev_payments",
    "description",
    "processing_notes",
    "property_address",
    "account_status",
    "website_name",
    "vendor_account_id",
)


def _invalid(message: str) -> APIError:
    return APIError({"code": "22023", "message": message})


def _reject_unknown_fields(
    fields: dict[str, Any],
    allowed: tuple[str, ...],
) -> None:
    unknown = sorted(set(fields) - set(allowed))

    if unknown:
        raise _invalid(f"unknown vendor account fields: {', '.join(unknown)}")


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.storage = _Storage()
        # Vault: secret id -> plaintext. The real one stores ciphertext.
        self.vault: dict[str, str] = {}
        # Vault writes raise, as when Vault is unavailable mid-transaction.
        self.fail_vault_writes = False
        # Names of the functions called through rpc(), in order.
        self.rpc_calls: list[str] = []

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def rpc(
        self,
        name: str,
        params: dict[str, Any],
    ) -> _Rpc:
        return _Rpc(self, name, params)

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Undo every row and Vault change if the body raises.

        Rows are restored in place, so a test holding a row dict sees the
        rolled-back values. A table first touched inside the transaction is
        left in place, empty.
        """
        saved_rows = {
            name: [(row, dict(row)) for row in rows]
            for name, rows in self.tables.items()
        }
        saved_vault = dict(self.vault)

        try:
            yield
        except BaseException:
            for name, rows in self.tables.items():
                saved = saved_rows.get(name, [])

                for row, values in saved:
                    row.clear()
                    row.update(values)

                rows[:] = [row for row, _ in saved]

            self.vault.clear()
            self.vault.update(saved_vault)
            raise

    def after_delete(
        self,
        table: str,
        row: dict[str, Any],
    ) -> None:
        # Trigger behavior: deleting a vendor account removes its Vault secret.
        if table == "vendor_accounts":
            secret_id = row.get("portal_password_secret_id")

            if secret_id:
                self.vault.pop(secret_id, None)

    def find(
        self,
        table: str,
        column: str,
        value: Any,
    ) -> dict[str, Any] | None:
        rows = self.tables.get(table, [])

        return next(
            (row for row in rows if row.get(column) == value),
            None,
        )

    # ------------------------------------------------------------------
    # Test data helpers
    # ------------------------------------------------------------------

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

    def add_vendor(
        self,
        vendor_name: str,
        **fields: Any,
    ) -> dict[str, Any]:
        row = {
            **_insert_defaults("vendors"),
            "vendor_name": vendor_name,
            "contact_email": None,
            "contact_phone": None,
            "default_payment_method": None,
            **fields,
        }
        self.table("vendors")._rows.append(row)
        return row

    def add_property(
        self,
        property_name: str = "Elm Court",
        **fields: Any,
    ) -> dict[str, Any]:
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
        self,
        property_id: str,
        vendor_id: str,
        **fields: Any,
    ) -> dict[str, Any]:
        """An account row; set its password through the `update_vendor_account`
        rpc, as the repository does."""
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

    def add_bill(
        self,
        submitted_by: str,
        **fields: Any,
    ) -> dict[str, Any]:
        """Add a bill row and ensure its submitter exists."""
        if not self.find("app_users", "user_id", submitted_by):
            self.add_user(submitted_by)

        row = {
            "bill_id": str(uuid4()),
            "submitted_by": submitted_by,
            "status": "draft",
            "document_path": None,
            "vendor_account_picked": False,
            "created_at": datetime.now(UTC).isoformat(),
            **fields,
        }
        self.tables.setdefault("bills", []).append(row)
        return row

    def add_approval(
        self,
        bill_id: str,
        **fields: Any,
    ) -> dict[str, Any]:
        """Add an approval record for an existing bill."""
        row = {
            **_insert_defaults("approvals"),
            "bill_id": bill_id,
            **fields,
        }
        self.tables.setdefault("approvals", []).append(row)
        return row

    def add_payment_run(
        self,
        bill_id: str,
        started_by: str,
        **fields: Any,
    ) -> dict[str, Any]:
        """A payment run row, queued unless `fields` say otherwise."""
        row = {
            **_insert_defaults("payment_runs"),
            "bill_id": bill_id,
            "started_by": started_by,
            **fields,
        }
        self.table("payment_runs")._rows.append(row)
        return row

    # ------------------------------------------------------------------
    # Approval workflow RPC twins
    # ------------------------------------------------------------------

    def _ensure_no_pending_approval(self, bill_id: str) -> None:
        pending = next(
            (
                approval
                for approval in self.tables.get("approvals", [])
                if approval.get("bill_id") == bill_id
                and approval.get("approval_status") == "pending"
            ),
            None,
        )

        if pending is not None:
            raise _sql_error(
                "This bill already has a pending approval.",
                "P0001",
            )

    def _apply_approval_bill_fields(
        self,
        bill: dict[str, Any],
        fields: dict[str, Any],
    ) -> None:
        if not isinstance(fields, dict):
            raise _invalid("Bill fields must be a JSON object.")

        unknown = sorted(set(fields) - set(APPROVAL_BILL_FIELDS))

        if unknown:
            raise _invalid(f"Unknown bill fields: {', '.join(unknown)}")

        # Omitted values are preserved. Explicit nulls remain explicit nulls.
        for field, value in fields.items():
            bill[field] = value

    def _apply_vendor_match(
        self,
        bill: dict[str, Any],
        pick: str | None,
    ) -> None:
        """Python twin of the vendor-account match in the bill RPCs.

        The number rule is the real one, imported from
        vendor_account_matching, so the fake cannot drift from it.
        """
        account: dict[str, Any] | None = None
        picked = False

        if pick is not None:
            account = self.find("vendor_accounts", "account_id", str(pick))

            if account is None:
                raise _invalid("Vendor account not found.")

            if account.get("status") != "active":
                raise _invalid("This vendor account is inactive.")

            picked = True
        else:
            active = [
                candidate
                for candidate in self.tables.get("vendor_accounts", [])
                if candidate.get("status") == "active"
            ]
            matches = same_account_number(active, bill.get("account_number_raw"))

            if len(matches) == 1:
                account = matches[0]

        bill["vendor_account_id"] = account["account_id"] if account else None
        bill["vendor_id"] = account["vendor_id"] if account else None
        bill["property_id"] = account["property_id"] if account else None
        bill["vendor_account_picked"] = picked

        self._check_invoice_unique(bill)

    def _check_invoice_unique(self, bill: dict[str, Any]) -> None:
        # bills_account_invoice_unique
        key = _bill_invoice_key(bill)

        if key is None:
            return

        for other in self.tables.get("bills", []):
            if other is not bill and _bill_invoice_key(other) == key:
                raise APIError(
                    {
                        "code": "23505",
                        "message": (
                            "duplicate key on bills (bills_account_invoice_unique)"
                        ),
                    }
                )

    def _rpc_create_bill_with_approval(
        self,
        p_fields: dict[str, Any],
        p_user_id: str,
    ) -> str:
        if not isinstance(p_fields, dict):
            raise _invalid("Bill fields must be a JSON object.")

        self._apply_approval_bill_fields({}, p_fields)

        bill = self.add_bill(
            submitted_by=p_user_id,
            status="pending_approval",
            **p_fields,
        )

        self._apply_vendor_match(bill, p_fields.get("vendor_account_id"))

        self.add_approval(bill_id=bill["bill_id"])
        return bill["bill_id"]

    def _rpc_submit_draft_bill_with_approval(
        self,
        p_bill_id: str,
        p_fields: dict[str, Any],
        p_user_id: str,
    ) -> str:
        bill = self.find("bills", "bill_id", p_bill_id)

        if bill is None:
            raise _sql_error("Editable draft not found.", "P0002")

        if bill["submitted_by"] != p_user_id:
            raise _sql_error("Editable draft not found.", "42501")

        if bill["status"] != "draft":
            raise _sql_error(
                "This bill has already been submitted.",
                "P0001",
            )

        self._ensure_no_pending_approval(p_bill_id)
        self._apply_approval_bill_fields(bill, p_fields)
        self._apply_vendor_match(bill, p_fields.get("vendor_account_id"))

        now = datetime.now(UTC).isoformat()
        bill["status"] = "pending_approval"
        bill["updated_at"] = now

        self.add_approval(
            bill_id=p_bill_id,
            approval_status="pending",
        )

        return p_bill_id

    def _rpc_resubmit_bill_with_approval(
        self,
        p_bill_id: str,
        p_fields: dict[str, Any],
        p_user_id: str,
    ) -> str:
        bill = self.find("bills", "bill_id", p_bill_id)

        if bill is None:
            raise _sql_error("Bill not found.", "P0002")

        if bill["submitted_by"] != p_user_id:
            raise _sql_error(
                "You are not authorized to resubmit this bill.",
                "42501",
            )

        if bill["status"] != "rejected":
            raise _sql_error(
                "Only rejected bills can be resubmitted.",
                "P0001",
            )

        self._ensure_no_pending_approval(p_bill_id)
        self._apply_approval_bill_fields(bill, p_fields)
        self._apply_vendor_match(bill, p_fields.get("vendor_account_id"))

        now = datetime.now(UTC).isoformat()
        bill["status"] = "pending_approval"
        bill["updated_at"] = now

        # The previous rejected approval is retained as history.
        self.add_approval(
            bill_id=p_bill_id,
            approval_status="pending",
        )

        return p_bill_id

    def _rpc_decide_bill_approval(
        self,
        p_approval_id: str,
        p_reviewer_id: str,
        p_decision: str,
        p_comments: str | None = None,
    ) -> dict[str, Any]:
        if p_decision not in {"approve", "reject"}:
            raise _sql_error(
                "Invalid approval decision.",
                "22023",
            )

        comments = p_comments.strip() if p_comments else None

        if p_decision == "reject" and not comments:
            raise _sql_error(
                "A comment is required when rejecting an approval.",
                "22023",
            )

        approval = self.find(
            "approvals",
            "approval_id",
            p_approval_id,
        )

        if approval is None:
            raise _sql_error("Approval record not found.", "P0002")

        if approval["approval_status"] != "pending":
            raise _sql_error(
                "This approval has already been decided.",
                "P0001",
            )

        bill = self.find(
            "bills",
            "bill_id",
            approval["bill_id"],
        )

        if bill is None:
            raise _sql_error(
                "Associated bill not found.",
                "P0002",
            )

        if bill["status"] != "pending_approval":
            raise _sql_error(
                "This bill is not awaiting approval.",
                "P0001",
            )

        reviewer = self.find(
            "app_users",
            "user_id",
            p_reviewer_id,
        )

        if reviewer is None:
            raise _sql_error(
                "Reviewer account not found.",
                "P0002",
            )

        if reviewer["status"] != "active":
            raise _sql_error(
                "Reviewer account is not active.",
                "42501",
            )

        if reviewer["role"] not in {"approver", "admin"}:
            raise _sql_error(
                "User is not authorized to review approvals.",
                "42501",
            )

        amount = bill.get("amount")

        if amount is not None and float(amount) > 5000 and reviewer["role"] != "admin":
            raise _sql_error(
                "An admin must review bills over $5,000.",
                "42501",
            )

        decision_at = datetime.now(UTC).isoformat()
        approval_status = "approved" if p_decision == "approve" else "rejected"

        approval.update(
            {
                "approval_status": approval_status,
                "reviewer_id": p_reviewer_id,
                "decision_at": decision_at,
                "comments": comments,
                "updated_at": decision_at,
            }
        )

        bill["status"] = approval_status
        bill["updated_at"] = decision_at

        return {
            "approval_id": p_approval_id,
            "bill_id": approval["bill_id"],
            "approval_status": approval_status,
            "bill_status": approval_status,
            "reviewer_id": p_reviewer_id,
            "decision_at": decision_at,
            "comments": comments,
        }

    # ------------------------------------------------------------------
    # Payment RPC twins
    # ------------------------------------------------------------------

    def _rpc_record_payment(self, **params: Any) -> dict[str, Any]:
        return _record_payment(self, params)

    def _rpc_claim_next_payment_run(self) -> list[dict[str, Any]]:
        """Migration 20261117110000_payment_runs, without the row locks: the
        fake runs one call at a time."""
        now = datetime.now(UTC)
        runs = self.tables.setdefault("payment_runs", [])
        for run in runs:
            started = run["started_at"]
            if run["status"] == "running" and datetime.fromisoformat(
                started
            ) < now - timedelta(minutes=15):
                run.update(
                    status="flagged",
                    flag_reason="The worker stopped before this run finished. "
                    "Check the vendor portal before paying this bill again.",
                    finished_at=now.isoformat(),
                    steps=[
                        *run["steps"],
                        {
                            "at": now.isoformat(),
                            "step": "flagged",
                            "detail": "Run was still running after 15 minutes; "
                            "the worker probably stopped.",
                        },
                    ],
                )
        queued = sorted(
            (run for run in runs if run["status"] == "queued"),
            key=lambda run: (run["created_at"], run["run_id"]),
        )
        if not queued:
            return []
        run = queued[0]
        run.update(
            status="running",
            started_at=now.isoformat(),
            steps=[
                *run["steps"],
                {
                    "at": now.isoformat(),
                    "step": "claimed",
                    "detail": "A payment worker picked up this run.",
                },
            ],
        )
        return [dict(run)]

    # ------------------------------------------------------------------
    # Vendor-account and Vault RPC twins
    #
    # Python twins of the SQL functions in
    # 20261115100000_vendor_portal_login.sql. Keep them in step: same checks,
    # same order, same error codes.
    # ------------------------------------------------------------------

    def _locked_account(self, account_id: str) -> dict[str, Any]:
        account = self.find(
            "vendor_accounts",
            "account_id",
            account_id,
        )

        if account is None:
            raise APIError(
                {
                    "code": "P0002",
                    "message": f"vendor account {account_id} not found",
                }
            )

        return account

    def _write_vault(
        self,
        secret_id: str,
        password: str,
    ) -> None:
        if self.fail_vault_writes:
            raise APIError(
                {
                    "code": "XX000",
                    "message": "vault unavailable",
                }
            )

        self.vault[secret_id] = password

    # set_vendor_account_portal_password: a building block, not callable by
    # the service role, so not an `_rpc_` twin.
    def _set_portal_password(
        self,
        account_id: str,
        password: str | None,
    ) -> None:
        if not password:
            raise _invalid("portal password must not be empty")

        account = self._locked_account(account_id)
        secret_id = account["portal_password_secret_id"]

        if secret_id is None:
            secret_id = str(uuid4())
            self._write_vault(secret_id, password)
            account["portal_password_secret_id"] = secret_id
        else:
            self._write_vault(secret_id, password)

    # clear_vendor_account_portal_password: a building block too.
    def _clear_portal_password(self, account_id: str) -> None:
        account = self._locked_account(account_id)
        secret_id = account["portal_password_secret_id"]

        if secret_id is not None:
            # Deleting the secret nulls the id (on delete set null).
            self.vault.pop(secret_id, None)
            account["portal_password_secret_id"] = None

    def _rpc_create_vendor_account(
        self,
        p_account: dict[str, Any],
        p_password: str | None,
    ) -> list[dict[str, Any]]:
        if not isinstance(p_account, dict):
            raise _invalid("vendor account must be a JSON object")

        _reject_unknown_fields(
            p_account,
            ACCOUNT_CREATE_FIELDS,
        )

        # A missing key reads as null, as `->>` does.
        values = {field: p_account.get(field) for field in ACCOUNT_CREATE_FIELDS}

        created = self.table("vendor_accounts").insert(values).execute()

        assert created is not None
        account_id = created.data[0]["account_id"]

        if p_password is not None:
            self._set_portal_password(account_id, p_password)

        return [dict(self._locked_account(account_id))]

    def _rpc_update_vendor_account(
        self,
        p_account_id: str,
        p_changes: dict[str, Any],
        p_password_action: str,
        p_password: str | None,
    ) -> list[dict[str, Any]]:
        if p_password_action not in {"keep", "clear", "set"}:
            raise _invalid("portal password action must be keep, clear or set")

        if p_password_action != "set" and p_password is not None:
            raise _invalid("a portal password goes only with the set action")

        if not isinstance(p_changes, dict):
            raise _invalid("vendor account changes must be a JSON object")

        _reject_unknown_fields(
            p_changes,
            ACCOUNT_UPDATE_FIELDS,
        )

        if self.find("vendor_accounts", "account_id", p_account_id) is None:
            return []

        if p_changes:
            (
                self.table("vendor_accounts")
                .update(p_changes)
                .eq("account_id", p_account_id)
                .execute()
            )

        if p_password_action == "set":
            self._set_portal_password(
                p_account_id,
                p_password,
            )
        elif p_password_action == "clear":
            self._clear_portal_password(p_account_id)

        return [dict(self._locked_account(p_account_id))]

    def _rpc_get_vendor_account_portal_login(
        self,
        p_account_id: str,
    ) -> list[dict[str, Any]]:
        account = self.find(
            "vendor_accounts",
            "account_id",
            p_account_id,
        )

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

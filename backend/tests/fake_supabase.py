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
FOREIGN_KEYS = {
    ("bills", "submitted_by"): ("app_users", "user_id"),
    ("approvals", "reviewer_id"): ("app_users", "user_id"),
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
    return {"bill_id": str(uuid4()), "document_path": None, "created_at": now}


class _Rpc:
    def __init__(
        self,
        db: "FakeSupabase",
        function: str,
        params: dict[str, Any],
    ) -> None:
        self._db = db
        self._function = function
        self._params = params

    def execute(self) -> _Result:
        if self._function == "create_bill_with_approval":
            bill_id = self._db.create_bill_with_approval(
                fields=self._params["p_fields"],
                user_id=self._params["p_user_id"],
            )
            return _Result(bill_id)

        if self._function == "resubmit_bill_with_approval":
            bill_id = self._params["p_bill_id"]
            fields = self._params["p_fields"]
            user_id = self._params["p_user_id"]

            resubmitted_id = self._db.resubmit_bill_with_approval(
                bill_id=bill_id,
                fields=fields,
                user_id=user_id,
            )

            return _Result(resubmitted_id)

        if self._function == "decide_bill_approval":
            approval_id = self._params["p_approval_id"]
            reviewer_id = self._params["p_reviewer_id"]
            decision = self._params["p_decision"]
            comments = self._params.get("p_comments")

            approval = self._db.find("approvals", "approval_id", approval_id)
            if approval is None:
                raise ValueError("Approval record not found.")

            bill = self._db.find("bills", "bill_id", approval["bill_id"])
            if bill is None:
                raise ValueError("Associated bill not found.")

            if approval["approval_status"] != "pending":
                raise ValueError("This approval has already been decided.")

            if bill["status"] != "pending_approval":
                raise ValueError("This bill is not awaiting approval.")

            reviewer = self._db.find("app_users", "user_id", reviewer_id)
            if reviewer is None:
                raise ValueError("Reviewer account not found.")

            if reviewer["status"] != "active":
                raise ValueError("Reviewer account is not active.")

            if reviewer["role"] not in {"approver", "admin"}:
                raise ValueError("User is not authorized to review approvals.")

            amount = bill.get("amount")
            if (
                amount is not None
                and float(amount) > 5000
                and reviewer["role"] != "admin"
            ):
                raise ValueError("An admin must review bills over $5,000.")

            if decision not in {"approve", "reject"}:
                raise ValueError("Invalid approval decision.")

            comments = comments.strip() if comments else None
            if decision == "reject" and not comments:
                raise ValueError("A comment is required when rejecting an approval.")

            decision_at = datetime.now(UTC).isoformat()
            approval_status = "approved" if decision == "approve" else "rejected"

            approval.update(
                {
                    "approval_status": approval_status,
                    "reviewer_id": reviewer_id,
                    "decision_at": decision_at,
                    "comments": comments,
                    "updated_at": decision_at,
                }
            )

            bill["status"] = approval_status
            bill["updated_at"] = decision_at

            return _Result(
                {
                    "approval_id": approval_id,
                    "bill_id": approval["bill_id"],
                    "approval_status": approval_status,
                    "bill_status": approval_status,
                    "reviewer_id": reviewer_id,
                    "decision_at": decision_at,
                    "comments": comments,
                }
            )

        raise NotImplementedError(f"RPC function {self._function!r} is not supported")


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
        self._range: tuple[int, int] | None = None

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

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._columns is None:
            return row
        keep = set(self._columns) | {alias for alias, *_ in self._embeds}
        return {column: value for column, value in row.items() if column in keep}

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

            if self._range is not None:
                start, end = self._range
                rows = rows[start : end + 1]

        copies = [self._project(self._embed(dict(row))) for row in rows]

        if self._single == "maybe":
            # supabase-py returns None, not an empty result, for no match.
            return _Result(copies[0]) if copies else None

        if self._single == "one":
            assert len(copies) == 1, f"single() matched {len(copies)} rows"
            return _Result(copies[0])

        return _Result(copies)

    def range(self, start: int, end: int):
        self._range = (start, end)
        return self


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


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.storage = _Storage()

    def table(self, name: str) -> _Query:
        return _Query(self, name)

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

    def add_approval(
        self,
        bill_id: str,
        **fields: Any,
    ) -> dict[str, Any]:
        """Add an approval record for an existing bill."""
        now = datetime.now(UTC).isoformat()

        row = {
            "approval_id": str(uuid4()),
            "bill_id": bill_id,
            "reviewer_id": None,
            "requested_at": now,
            "decision_at": None,
            "comments": None,
            "approval_status": "pending",
            "created_at": now,
            "updated_at": now,
            **fields,
        }

        self.tables.setdefault("approvals", []).append(row)
        return row

    def rpc(
        self,
        function: str,
        params: dict[str, Any],
    ) -> _Rpc:
        return _Rpc(self, function, params)

    def create_bill_with_approval(
        self,
        fields: dict[str, Any],
        user_id: str,
    ) -> str:
        """Simulate the atomic bill-and-approval database function."""
        now = datetime.now(UTC).isoformat()

        bill = self.add_bill(
            submitted_by=user_id,
            status="pending_approval",
            **fields,
        )

        approval = {
            "approval_id": str(uuid4()),
            "bill_id": bill["bill_id"],
            "reviewer_id": None,
            "requested_at": now,
            "decision_at": None,
            "comments": None,
            "approval_status": "pending",
            "created_at": now,
            "updated_at": now,
        }

        self.tables.setdefault("approvals", []).append(approval)

        return bill["bill_id"]

    def resubmit_bill_with_approval(
        self,
        bill_id: str,
        fields: dict[str, Any],
        user_id: str,
    ) -> str:
        """Simulate atomic resubmission of a rejected bill."""

        bill = self.find("bills", "bill_id", bill_id)

        if bill is None:
            raise ValueError("Bill not found.")

        if bill["submitted_by"] != user_id:
            raise ValueError("You are not authorized to resubmit this bill.")

        if bill["status"] != "rejected":
            raise ValueError("Only rejected bills can be resubmitted.")

        # Match the database's partial unique index.
        existing_pending = any(
            approval["bill_id"] == bill_id and approval["approval_status"] == "pending"
            for approval in self.tables.get("approvals", [])
        )

        if existing_pending:
            raise ValueError("This bill already has a pending approval.")

        now = datetime.now(UTC).isoformat()

        # Update the existing bill. Preserve its document_path.
        bill_fields = (
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
        )

        for field in bill_fields:
            bill[field] = fields.get(field)

        bill["status"] = "pending_approval"
        bill["updated_at"] = now

        # Insert a new approval, preserving previous approval history.
        self.add_approval(
            bill_id=bill_id,
            approval_status="pending",
        )

        return bill_id

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

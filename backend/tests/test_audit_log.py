"""The audit log API (DC-89): `GET /audit/changes` and
`GET /bills/{bill_id}/history`, against FakeSupabase, whose `capture_change`
and `audit_*` rpc twins mirror the audit trigger and the read functions.
Which roles may call the routes is the role table in test_route_permissions.py;
this file checks the answers.
"""

import ast
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from backend.api.audit import router as audit_router
from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

ADMIN = str(uuid4())
ANALYST = str(uuid4())
APPROVER = str(uuid4())

T0 = datetime(2026, 11, 17, 21, 0, tzinfo=UTC)

SRC = Path(__file__).resolve().parents[1] / "src" / "backend"


@pytest.fixture
def db():
    fake = FakeSupabase()
    fake.add_user(ADMIN, full_name="Ada Admin", role="admin")
    fake.add_user(ANALYST, full_name="Ann Analyst", role="analyst")
    fake.add_user(APPROVER, full_name="Try Approver", role="approver")
    with patch("backend.api.audit.get_admin_supabase", return_value=fake):
        yield fake


@pytest.fixture
def admin(db) -> TestClient:
    user = make_user(ADMIN, role=UserRole.admin)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


def iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


# ----------------------------------------------------------------------
# Who may read
# ----------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/audit/changes", f"/bills/{uuid4()}/history"])
def test_signed_out_callers_get_401(db, path):
    response = TestClient(app).get(path)

    assert response.status_code == 401
    assert db.rpc_calls == []


@pytest.mark.parametrize(
    ("role", "status"),
    [
        (UserRole.analyst, "active"),
        (UserRole.approver, "active"),
        (UserRole.admin, "inactive"),
    ],
)
@pytest.mark.parametrize("path", ["/audit/changes", "/bills/{bill_id}/history"])
def test_only_active_admins_read_the_log(db, role, status, path):
    bill = db.add_bill(ANALYST)
    user = make_user(role=role, status=status)
    app.dependency_overrides[get_current_user] = lambda: user

    response = TestClient(app).get(path.format(bill_id=bill["bill_id"]))

    assert response.status_code == 403
    assert db.rpc_calls == []


def _string_constants(tree: ast.AST) -> list[tuple[str, int]]:
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(
            node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
        )
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
    }
    return [
        (node.value, node.lineno)
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
    ]


def test_no_other_code_reads_the_log():
    # The read functions and the log table are named in code (not docs) only
    # by the repository, and only the audit routes and the bill history (which
    # only the audit routes import) import it. test_route_permissions.py
    # also checks that no other route calls the functions.
    log_names = {"audit_changes", "audit_bill_changes"}
    readers: set[str] = set()
    importers: dict[str, set[str]] = {}

    for path in sorted(SRC.rglob("*.py")):
        tree = ast.parse(path.read_text())
        name = path.relative_to(SRC).as_posix()
        for value, _line in _string_constants(tree):
            if value in log_names or "record_changes" in value:
                readers.add(name)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                importers.setdefault(node.module, set()).add(name)

    assert readers == {"services/audit_log_repository.py"}
    assert importers["backend.services.audit_log_repository"] == {
        "services/bill_history.py",
        "api/audit.py",
    }
    assert importers["backend.services.bill_history"] == {"api/audit.py"}

    audit_routes = {
        (method, route.path)
        for route in audit_router.routes
        for method in route.methods
    }
    assert audit_routes == {
        ("GET", "/audit/changes"),
        ("GET", "/bills/{bill_id}/history"),
    }


# ----------------------------------------------------------------------
# GET /audit/changes
# ----------------------------------------------------------------------


def seed_vendor_change(db: FakeSupabase, minutes: int, **fields) -> dict:
    vendor_id = str(uuid4())
    return db.capture_change(
        "vendors",
        "INSERT",
        new={"vendor_id": vendor_id, "vendor_name": "City Water", **fields},
        actor_id=ADMIN,
        occurred_at=at(minutes),
    )


def test_a_change_has_the_contract_shape(db, admin):
    bill_id = str(uuid4())
    old = {"bill_id": bill_id, "status": "pending_approval", "amount": 186.42}
    new = {**old, "status": "approved"}
    db.capture_change(
        "bills", "UPDATE", old=old, new=new, actor_id=APPROVER, occurred_at=at(8)
    )

    response = admin.get("/audit/changes")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": 1,
                "occurred_at": iso(at(8)),
                "table": "bills",
                "action": "changed",
                "record_id": bill_id,
                "bill_id": bill_id,
                "actor": {
                    "id": APPROVER,
                    "name": "Try Approver",
                    "role": "service_role",
                },
                "changed_fields": ["status"],
                "before": old,
                "after": new,
            }
        ],
        "next_before_id": None,
    }


def test_inserts_and_deletes_have_no_changed_fields(db, admin):
    row = {"property_id": str(uuid4()), "property_name": "Oak Row"}
    db.capture_change("properties", "INSERT", new=row, actor_id=ADMIN)
    db.capture_change("properties", "DELETE", old=row, actor_id=ADMIN)

    items = admin.get("/audit/changes").json()["items"]

    assert [(i["action"], i["changed_fields"]) for i in items] == [
        ("deleted", []),
        ("created", []),
    ]
    assert items[0]["before"] == row and items[0]["after"] is None
    assert items[1]["before"] is None and items[1]["after"] == row
    assert {i["record_id"] for i in items} == {row["property_id"]}
    assert {i["bill_id"] for i in items} == {None}


def test_actor_is_the_current_name_or_null(db, admin):
    gone = str(uuid4())
    seed_vendor_change(db, 1)
    db.capture_change(
        "vendors",
        "INSERT",
        new={"vendor_id": str(uuid4())},
        actor_id=gone,
        actor_role="authenticated",
    )
    db.capture_change(
        "vendors", "INSERT", new={"vendor_id": str(uuid4())}, actor_role="postgres"
    )
    db.find("app_users", "user_id", ADMIN)["full_name"] = "Ada Renamed"

    actors = [i["actor"] for i in admin.get("/audit/changes").json()["items"]]

    assert actors == [
        {"id": None, "name": None, "role": "postgres"},
        {"id": gone, "name": None, "role": "authenticated"},
        {"id": ADMIN, "name": "Ada Renamed", "role": "service_role"},
    ]


def test_masked_values_come_back_masked(db, admin):
    account = {
        "account_id": str(uuid4()),
        "account_number": "2000456700",
        "account_type": "water",
    }
    stored = db.capture_change("vendor_accounts", "INSERT", new=account)
    assert stored["new_row"]["account_number"] == "****6700"

    response = admin.get("/audit/changes", params={"table": "vendor_accounts"})

    assert response.json()["items"][0]["after"] == stored["new_row"]
    assert "2000456700" not in response.text
    assert "456700" not in response.text


def test_rows_stored_before_a_column_was_masked_come_back_masked(db, admin):
    # A vendor account change logged before portal_password_secret_id joined
    # audit.mask holds the full Vault id; both routes mask it on read.
    secret_id = "7d2c4e1a-9b3f-4c8d-a1e2-5f6a7b8c1c90"
    bill_id = str(uuid4())
    db.audit_log.append(
        {
            "id": 1,
            "table_schema": "public",
            "table_name": "vendor_accounts",
            "op": "UPDATE",
            "record_pk": {"account_id": "a1"},
            "bill_id": bill_id,
            "old_row": {"portal_password_secret_id": None},
            "new_row": {"portal_password_secret_id": secret_id},
            "changed_cols": ["portal_password_secret_id"],
            "actor_id": None,
            "actor_role": "service_role",
            "occurred_at": "2026-11-16T21:06:00+00:00",
        }
    )
    db.tables.setdefault("bills", []).append({"bill_id": bill_id})

    changes = admin.get("/audit/changes")
    history = admin.get(f"/bills/{bill_id}/history")

    assert changes.json()["items"][0]["after"] == {
        "portal_password_secret_id": "****1c90"
    }
    for response in (changes, history):
        assert response.status_code == 200
        assert secret_id not in response.text
        assert "5f6a7b8c" not in response.text


def test_a_table_audited_later_is_still_listed(db, admin):
    # A table the triggers start watching after this API was written: the
    # unfiltered list serves its rows rather than failing validation.
    seed_vendor_change(db, 1)
    db.audit_log.append(
        {
            **db.audit_log[0],
            "id": 2,
            "table_name": "invoice_notes",
            "record_pk": {"note_id": "n1"},
        }
    )

    items = admin.get("/audit/changes").json()["items"]

    assert [(i["id"], i["table"], i["record_id"]) for i in items] == [
        (2, "invoice_notes", "n1"),
        (1, "vendors", items[1]["record_id"]),
    ]


def test_a_single_row_table_has_no_record_id(db, admin):
    # autopay_settings is one row keyed by `id = true`: no record to name.
    seed_vendor_change(db, 1)
    db.audit_log[0] = {
        **db.audit_log[0],
        "table_name": "autopay_settings",
        "record_pk": {"id": True},
        "bill_id": None,
    }

    items = admin.get("/audit/changes").json()["items"]

    assert [(i["table"], i["record_id"]) for i in items] == [("autopay_settings", None)]


def test_table_filter(db, admin):
    seed_vendor_change(db, 1)
    db.capture_change("properties", "INSERT", new={"property_id": str(uuid4())})

    items = admin.get("/audit/changes", params={"table": "properties"}).json()["items"]

    assert [i["table"] for i in items] == ["properties"]
    assert db.rpc_calls == ["audit_changes"]


def test_actor_filter(db, admin):
    seed_vendor_change(db, 1)
    db.capture_change("vendors", "INSERT", new={"vendor_id": "v2"}, actor_id=ANALYST)

    items = admin.get("/audit/changes", params={"actor_id": ANALYST}).json()["items"]

    assert [i["actor"]["id"] for i in items] == [ANALYST]


def test_bill_filter(db, admin):
    bill_id = str(uuid4())
    db.capture_change("bills", "INSERT", new={"bill_id": bill_id, "status": "draft"})
    db.capture_change(
        "approvals",
        "INSERT",
        new={"approval_id": str(uuid4()), "bill_id": bill_id},
    )
    db.capture_change("bills", "INSERT", new={"bill_id": str(uuid4())})
    seed_vendor_change(db, 1)

    items = admin.get("/audit/changes", params={"bill_id": bill_id}).json()["items"]

    assert [(i["table"], i["bill_id"]) for i in items] == [
        ("approvals", bill_id),
        ("bills", bill_id),
    ]


def test_from_and_to_are_inclusive_utc_days(db, admin):
    day = datetime(2026, 11, 10, tzinfo=UTC)
    for moment in (
        day - timedelta(seconds=1),  # 1: the day before
        day,  # 2: first instant of the 10th
        day + timedelta(days=2, hours=23, minutes=59),  # 3: late on the 12th
        day + timedelta(days=3),  # 4: the 13th
    ):
        db.capture_change(
            "vendors", "INSERT", new={"vendor_id": str(uuid4())}, occurred_at=moment
        )

    def ids(**params) -> list[int]:
        items = admin.get("/audit/changes", params=params).json()["items"]
        return [i["id"] for i in items]

    assert ids(**{"from": "2026-11-10"}) == [4, 3, 2]
    assert ids(to="2026-11-12") == [3, 2, 1]
    assert ids(**{"from": "2026-11-10", "to": "2026-11-12"}) == [3, 2]
    assert ids(**{"from": "2026-11-12", "to": "2026-11-12"}) == [3]
    assert ids(**{"from": "2026-11-13", "to": "2026-11-12"}) == []


def test_filters_combine(db, admin):
    seed_vendor_change(db, 1)
    db.capture_change("vendors", "INSERT", new={"vendor_id": "v2"}, actor_id=ANALYST)
    db.capture_change(
        "properties", "INSERT", new={"property_id": "p1"}, actor_id=ANALYST
    )

    items = admin.get(
        "/audit/changes", params={"table": "vendors", "actor_id": ANALYST}
    ).json()["items"]

    assert [i["id"] for i in items] == [2]


def test_keyset_paging(db, admin):
    for minute in range(5):
        seed_vendor_change(db, minute)

    def page(**params) -> tuple[list[int], int | None]:
        body = admin.get("/audit/changes", params={"limit": 2, **params}).json()
        return [i["id"] for i in body["items"]], body["next_before_id"]

    assert page() == ([5, 4], 4)
    assert page(before_id=4) == ([3, 2], 2)
    assert page(before_id=2) == ([1], None)
    # A last page that is exactly full says there is no more.
    assert page(before_id=3) == ([2, 1], None)
    assert page(before_id=1) == ([], None)


def test_default_page_is_fifty_newest_first(db, admin):
    for minute in range(51):
        seed_vendor_change(db, minute)

    body = admin.get("/audit/changes").json()

    assert [i["id"] for i in body["items"]] == list(range(51, 1, -1))
    assert body["next_before_id"] == 2


def test_a_hundred_is_the_largest_page(db, admin):
    for minute in range(101):
        seed_vendor_change(db, minute)

    body = admin.get("/audit/changes", params={"limit": 100}).json()

    assert len(body["items"]) == 100
    assert body["next_before_id"] == 2


@pytest.mark.parametrize(
    "params",
    [
        {"table": "payment_runs"},
        {"table": "audit_events"},
        {"table": "record_changes"},
        {"limit": 0},
        {"limit": 101},
        {"limit": "ten"},
        {"before_id": 0},
        {"actor_id": "not-a-uuid"},
        {"bill_id": "42"},
        {"from": "17/11/2026"},
        {"to": "2026-13-01"},
    ],
)
def test_bad_parameters_are_422(db, admin, params):
    response = admin.get("/audit/changes", params=params)

    assert response.status_code == 422
    assert db.rpc_calls == []


@pytest.mark.parametrize(
    "params",
    [{"p_limit": 0}, {"p_limit": 101}, {"p_limit": None}, {"p_table": "payment_runs"}],
)
def test_the_function_twin_refuses_what_the_sql_refuses(db, params):
    with pytest.raises(APIError) as refused:
        db.rpc("audit_changes", params).execute()

    assert refused.value.code == "22023"


# ----------------------------------------------------------------------
# GET /bills/{bill_id}/history
# ----------------------------------------------------------------------


def events(client: TestClient, bill_id: str) -> list[dict]:
    response = client.get(f"/bills/{bill_id}/history")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["bill_id"] == bill_id
    return body["events"]


def brief(event: dict) -> tuple:
    return event["kind"], event["summary"], event["detail"]


def test_unknown_bill_is_404(db, admin):
    response = admin.get(f"/bills/{uuid4()}/history")

    assert response.status_code == 404
    assert response.json() == {"detail": "Bill not found."}


def test_a_bill_with_no_log_rows_has_no_events(db, admin):
    bill = db.add_bill(ANALYST)

    assert events(admin, bill["bill_id"]) == []


class Bill:
    """A bill whose changes are captured as the audit trigger would."""

    def __init__(self, db: FakeSupabase, **fields) -> None:
        self.db = db
        self.row = {
            "bill_id": str(uuid4()),
            "submitted_by": ANALYST,
            "status": "draft",
            "amount": 186.42,
            "due_date": "2026-12-01",
            "account_number_raw": "2000456700",
            "document_path": None,
            "vendor_account_id": None,
            "vendor_id": None,
            "property_id": None,
            **fields,
        }
        self.minute = 0
        db.add_bill(
            ANALYST, **{k: v for k, v in self.row.items() if k != "submitted_by"}
        )
        self.capture("bills", "INSERT", new=self.row)

    @property
    def id(self) -> str:
        return self.row["bill_id"]

    def capture(self, table: str, op: str, actor: str = ANALYST, **rows) -> dict:
        self.minute += 1
        return self.db.capture_change(
            table, op, actor_id=actor, occurred_at=at(self.minute), **rows
        )

    def update(self, actor: str = ANALYST, **changes) -> dict:
        old, self.row = self.row, {**self.row, **changes}
        return self.capture("bills", "UPDATE", actor=actor, old=old, new=self.row)

    def approval(self, actor: str = ANALYST, **fields) -> dict:
        row = {
            "approval_id": str(uuid4()),
            "bill_id": self.id,
            "approval_status": "pending",
            "comments": None,
            **fields,
        }
        self.capture("approvals", "INSERT", actor=actor, new=row)
        return row

    def decide(self, approval: dict, status: str, comments: str | None) -> None:
        new = {**approval, "approval_status": status, "comments": comments}
        self.capture("approvals", "UPDATE", actor=APPROVER, old=approval, new=new)

    def payment(self, **fields) -> None:
        row = {
            "payment_id": str(uuid4()),
            "bill_id": self.id,
            "amount": 186.42,
            "payment_method": "ach",
            "provider_reference": None,
            "failure_reason": None,
            **fields,
        }
        self.capture("payments", "INSERT", actor=APPROVER, new=row)


def account_of(db: FakeSupabase, vendor_name: str = "City Water") -> dict:
    vendor = db.add_vendor(vendor_name)
    prop = db.add_property()
    return db.add_vendor_account(
        prop["property_id"], vendor["vendor_id"], account_number="2000456700"
    )


def test_a_bills_whole_life(db, admin):
    account = account_of(db)
    bill = Bill(db)
    bill.update(amount=200.00, due_date="2026-12-15")
    bill.update(document_path="bills/a/invoice.pdf")
    bill.update(document_path="bills/a/invoice-2.pdf")
    bill.update(
        vendor_account_id=account["account_id"],
        vendor_id=account["vendor_id"],
        property_id=account["property_id"],
    )
    bill.update(status="pending_approval")
    first = bill.approval()
    bill.decide(first, "rejected", "Wrong amount")
    bill.update(actor=APPROVER, status="rejected")
    bill.update(status="pending_approval", amount=186.42)
    second = bill.approval()
    bill.update(actor=APPROVER, status="approved")
    bill.decide(second, "approved", "Looks good")
    bill.payment(payment_status="failed", failure_reason="Card declined")
    bill.payment(payment_status="completed", provider_reference="ACH-123")
    bill.update(actor=APPROVER, status="paid")

    timeline = events(admin, bill.id)

    assert [brief(e) for e in timeline] == [
        ("bill_created", "Created as a draft", None),
        ("bill_updated", "Draft updated", "Amount and due date"),
        ("document_added", "PDF added", None),
        ("document_replaced", "PDF replaced", None),
        (
            "vendor_account_matched",
            "Matched to a vendor account",
            "City Water, account ****6700",
        ),
        ("bill_submitted", "Submitted for approval", None),
        ("bill_rejected", "Rejected", "Wrong amount"),
        ("bill_resubmitted", "Resubmitted for approval", "Amount changed"),
        ("bill_approved", "Approved", "Looks good"),
        ("payment_failed", "Payment attempt failed", "Card declined"),
        ("payment_recorded", "Payment recorded", "$186.42 by ACH, reference ACH-123"),
        ("bill_paid", "Marked paid", None),
    ]
    # Oldest first, each from its log row, by whom.
    times = [e["at"] for e in timeline]
    assert times == sorted(times)
    assert all(e["run_id"] is None for e in timeline)
    assert [e["change_id"] for e in timeline] == [
        1,
        2,
        3,
        4,
        5,
        6,
        8,
        10,
        13,
        14,
        15,
        16,
    ]
    assert timeline[0]["actor"] == {"id": ANALYST, "name": "Ann Analyst"}
    assert timeline[8]["actor"] == {"id": APPROVER, "name": "Try Approver"}
    assert "2000456700" not in admin.get(f"/bills/{bill.id}/history").text


def test_an_event_has_the_contract_shape(db, admin):
    bill = Bill(db, status="pending_approval")
    approval = {"approval_id": str(uuid4()), "bill_id": bill.id}
    approval |= {"approval_status": "pending", "comments": None}
    bill.decide(approval, "approved", "Looks good")

    assert events(admin, bill.id)[1] == {
        "at": iso(at(2)),
        "kind": "bill_approved",
        "summary": "Approved",
        "detail": "Looks good",
        "actor": {"id": APPROVER, "name": "Try Approver"},
        "change_id": 2,
        "run_id": None,
    }


def test_created_and_submitted_at_once(db, admin):
    account = account_of(db, "Alder Creek")
    bill = Bill(
        db,
        status="pending_approval",
        document_path="bills/b/invoice.pdf",
        vendor_account_id=account["account_id"],
    )
    bill.approval()

    assert [brief(e) for e in events(admin, bill.id)] == [
        ("bill_created", "Created and submitted for approval", None),
        ("document_added", "PDF added", None),
        (
            "vendor_account_matched",
            "Matched to a vendor account",
            "Alder Creek, account ****6700",
        ),
    ]


def test_submitting_with_edits_is_one_submission(db, admin):
    bill = Bill(db)
    bill.update(status="pending_approval", amount=99.99, document_path="b/x.pdf")

    assert [brief(e) for e in events(admin, bill.id)][1:] == [
        ("document_added", "PDF added", None),
        ("bill_submitted", "Submitted for approval", "Amount changed"),
    ]


def test_resubmitting_with_edits_is_one_resubmission(db, admin):
    bill = Bill(db, status="rejected")
    bill.update(status="pending_approval", amount=99.99, due_date="2026-12-20")

    assert [brief(e) for e in events(admin, bill.id)][1:] == [
        (
            "bill_resubmitted",
            "Resubmitted for approval",
            "Amount and due date changed",
        ),
    ]


def test_a_status_change_alone_has_no_detail(db, admin):
    bill = Bill(db, status="rejected")
    bill.update(status="pending_approval")

    assert [brief(e) for e in events(admin, bill.id)][1:] == [
        ("bill_resubmitted", "Resubmitted for approval", None),
    ]


def test_a_match_without_a_vendor_name_shows_the_masked_number(db, admin):
    bill = Bill(db)
    bill.update(vendor_account_id=str(uuid4()))

    assert brief(events(admin, bill.id)[1]) == (
        "vendor_account_matched",
        "Matched to a vendor account",
        "Account ****6700",
    )


def test_an_approval_or_rejection_without_comment(db, admin):
    bill = Bill(db, status="pending_approval")
    approval = bill.approval()
    bill.decide(approval, "rejected", None)

    assert brief(events(admin, bill.id)[-1]) == ("bill_rejected", "Rejected", None)


@pytest.mark.parametrize(
    ("method", "label"),
    [
        ("ach", "ACH"),
        ("check", "Check"),
        ("wire", "Wire"),
        ("credit_card", "Card"),
        ("other", "Other"),
    ],
)
def test_payment_methods_and_amounts(db, admin, method, label):
    bill = Bill(db, status="approved")
    bill.payment(payment_status="completed", payment_method=method, amount=1234.5)

    assert brief(events(admin, bill.id)[-1]) == (
        "payment_recorded",
        "Payment recorded",
        f"$1,234.50 by {label}",
    )


def test_anything_else_on_the_bill_is_other(db, admin):
    bill = Bill(db, status="approved")
    bill.update(status="exception")
    bill.update(amount=1.00)
    bill.payment(payment_status="pending")
    bill.capture("bills", "DELETE", old=bill.row)

    assert [brief(e) for e in events(admin, bill.id)][1:] == [
        ("other", "Bills changed", None),
        ("other", "Bills changed", None),
        ("other", "Payments created", None),
        ("other", "Bills deleted", None),
    ]


def run_row(db: FakeSupabase, bill: Bill, minute: int, **fields) -> dict:
    return db.add_payment_run(
        bill.id,
        APPROVER,
        created_at=at(minute).isoformat(),
        **fields,
    )


def test_payment_run_events(db, admin):
    bill = Bill(db, status="approved")
    paid = run_row(
        db,
        bill,
        10,
        status="paid",
        started_at=at(10).isoformat(),
        finished_at=at(11).isoformat(),
        receipt={"confirmation_number": "CONF-889"},
        payment_id=str(uuid4()),
    )
    failed = run_row(
        db,
        bill,
        5,
        status="failed",
        started_at=at(5).isoformat(),
        finished_at=at(6).isoformat(),
        payment_id=str(uuid4()),
    )
    flagged = run_row(
        db,
        bill,
        7,
        status="flagged",
        started_at=at(7).isoformat(),
        finished_at=at(8).isoformat(),
        flag_reason="The portal asked for a code.",
    )
    queued = run_row(db, bill, 20)

    timeline = events(admin, bill.id)

    assert [(brief(e), e["run_id"]) for e in timeline[1:]] == [
        (("run_started", "Pay with AI started", None), failed["run_id"]),
        (("run_failed", "The portal declined the payment", None), failed["run_id"]),
        (("run_started", "Pay with AI started", None), flagged["run_id"]),
        (
            ("run_flagged", "Flagged for a person", "The portal asked for a code."),
            flagged["run_id"],
        ),
        (("run_started", "Pay with AI started", None), paid["run_id"]),
        (("run_paid", "Paid by AI on the vendor portal", "CONF-889"), paid["run_id"]),
        (("run_started", "Pay with AI started", None), queued["run_id"]),
    ]
    starts = [e for e in timeline if e["kind"] == "run_started"]
    assert {(e["actor"]["id"], e["actor"]["name"]) for e in starts} == {
        (APPROVER, "Try Approver")
    }
    ends = [e for e in timeline[1:] if e["kind"] != "run_started"]
    assert all(e["actor"] is None and e["change_id"] is None for e in ends)
    assert timeline[2]["at"] == iso(at(6))


def test_an_autopay_run_says_so(db, admin):
    bill = Bill(db, status="approved")
    run_row(db, bill, 3, trigger="autopay")
    run_row(
        db,
        bill,
        4,
        status="flagged",
        trigger="manual",
        flag_reason="x",
        started_at=at(4).isoformat(),
        finished_at=at(5).isoformat(),
    )

    assert [e["summary"] for e in events(admin, bill.id)[1:]] == [
        "Autopay started a payment run",
        "Pay with AI started",
        "Flagged for a person",
    ]


def test_history_reads_only_its_bill(db, admin):
    bill = Bill(db)
    other = Bill(db)
    other.update(amount=5.00)

    assert [e["change_id"] for e in events(admin, bill.id)] == [1]
    assert db.rpc_calls == ["audit_bill_changes"]

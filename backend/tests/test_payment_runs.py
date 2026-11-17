"""Payment runs API: `POST`/`GET /bills/{bill_id}/payment-runs` and
`GET /payment-runs/{run_id}`, against FakeSupabase. Who may call each route
at all is checked by the role table in test_route_permissions.py."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

ANALYST = str(uuid4())
APPROVER = str(uuid4())
PASSWORD = "Portal-pw-Q7!x"


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.payment_runs.get_admin_supabase", return_value=fake):
        yield fake


def as_user(db: FakeSupabase, user_id: str, role: UserRole) -> TestClient:
    if not db.find("app_users", "user_id", user_id):
        db.add_user(user_id, role=role.value, full_name=f"Test {role}")
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id, role=role)
    return TestClient(app)


def approver(db: FakeSupabase) -> TestClient:
    return as_user(db, APPROVER, UserRole.approver)


def account(db: FakeSupabase, *, password: str | None = PASSWORD, **fields) -> dict:
    vendor = db.add_vendor("Alder Creek Landscaping")
    prop = db.add_property()
    login = {
        "account_number": "2000456700",
        "portal_url": "https://alder-creek-utility-demo.vercel.app",
        "portal_login_email": "demo@acme.com",
        **fields,
    }
    row = db.add_vendor_account(prop["property_id"], vendor["vendor_id"], **login)
    if password:
        db.rpc(
            "update_vendor_account",
            {
                "p_account_id": row["account_id"],
                "p_changes": {},
                "p_password_action": "set",
                "p_password": password,
            },
        ).execute()
    return row


def payable_bill(db: FakeSupabase, **fields) -> dict:
    vendor_account = fields.pop("vendor_account", None) or account(db)
    bill = {
        "status": "approved",
        "amount": "186.42",
        "invoice_number": "BILL-1001",
        "vendor_account_id": vendor_account["account_id"],
        **fields,
    }
    return db.add_bill(ANALYST, **bill)


def start(client: TestClient, bill: dict):
    return client.post(f"/bills/{bill['bill_id']}/payment-runs")


# Starting a run


@pytest.mark.parametrize("role", [UserRole.approver, UserRole.admin])
def test_approver_or_admin_queues_a_run(db, role):
    bill = payable_bill(db)
    user_id = str(uuid4())

    response = start(as_user(db, user_id, role), bill)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["bill_id"] == bill["bill_id"]
    assert body["started_by"] == user_id
    assert body["started_by_name"] == f"Test {role}"
    assert body["status"] == "queued"
    assert [s["step"] for s in body["steps"]] == ["queued"]
    assert body["steps"][0]["detail"] == f"Queued by Test {role}."
    for empty in ("flag_reason", "receipt", "payment_id", "started_at", "finished_at"):
        assert body[empty] is None
    assert db.tables["payment_runs"][0]["run_id"] == body["id"]


def test_starting_never_reads_or_returns_the_password(db):
    bill = payable_bill(db)

    response = start(approver(db), bill)

    assert response.status_code == 201
    assert PASSWORD not in response.text
    assert "get_vendor_account_portal_login" not in db.rpc_calls


@pytest.mark.parametrize(
    ("status", "detail"),
    [
        (
            "pending_approval",
            "Only approved bills can be paid. This bill is pending approval.",
        ),
        ("paid", "This bill has already been paid."),
        ("rejected", "Only approved bills can be paid. This bill is rejected."),
    ],
)
def test_only_an_approved_bill_gets_a_run(db, status, detail):
    bill = payable_bill(db, status=status)

    response = start(approver(db), bill)

    assert response.status_code == 409
    assert response.json()["detail"] == detail
    assert db.tables.get("payment_runs", []) == []


@pytest.mark.parametrize("active", ["queued", "running"])
def test_one_active_run_per_bill(db, active):
    bill = payable_bill(db)
    started = (
        {"started_at": datetime.now(UTC).isoformat()} if active == "running" else {}
    )
    db.add_payment_run(bill["bill_id"], APPROVER, status=active, **started)

    response = start(approver(db), bill)

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "A payment run is already in progress for this bill."
    )
    assert len(db.tables["payment_runs"]) == 1


def test_a_finished_run_does_not_block_a_new_one(db):
    bill = payable_bill(db)
    now = datetime.now(UTC).isoformat()
    db.add_payment_run(
        bill["bill_id"],
        APPROVER,
        status="flagged",
        flag_reason="Amount differs.",
        started_at=now,
        finished_at=now,
    )

    assert start(approver(db), bill).status_code == 201


def test_bill_without_a_vendor_account_is_422(db):
    bill = db.add_bill(ANALYST, status="approved", amount="186.42")

    response = start(approver(db), bill)

    assert response.status_code == 422
    assert response.json()["detail"] == "This bill isn't matched to a vendor account."


@pytest.mark.parametrize(
    "missing",
    [{"password": None}, {"portal_url": None}, {"portal_login_email": None}],
    ids=["password", "portal_url", "email"],
)
def test_account_without_a_portal_login_is_422(db, missing):
    bill = payable_bill(db, vendor_account=account(db, **missing))

    response = start(approver(db), bill)

    assert response.status_code == 422
    assert "no portal login" in response.json()["detail"]


def test_bill_with_an_inactive_vendor_account_is_422(db):
    bill = payable_bill(db, vendor_account=account(db, status="inactive"))

    response = start(approver(db), bill)

    assert response.status_code == 422
    assert response.json()["detail"] == "This bill's vendor account is inactive."
    assert db.tables.get("payment_runs", []) == []


def test_a_bill_the_caller_cannot_read_is_404(db):
    # Another user's draft: invisible, so not a 409 either.
    bill = payable_bill(db, status="draft")

    response = start(approver(db), bill)

    assert response.status_code == 404
    assert response.json()["detail"] == "Bill not found."


def test_unknown_bill_is_404(db):
    response = approver(db).post(f"/bills/{uuid4()}/payment-runs")

    assert response.status_code == 404


# Reading runs


def test_list_is_newest_first(db):
    bill = payable_bill(db)
    other = payable_bill(db, invoice_number="BILL-2", vendor_account=account(db))
    now = datetime.now(UTC)
    old = db.add_payment_run(
        bill["bill_id"],
        APPROVER,
        status="flagged",
        flag_reason="Timed out.",
        started_at=now.isoformat(),
        finished_at=now.isoformat(),
        created_at=(now - timedelta(hours=1)).isoformat(),
    )
    new = db.add_payment_run(bill["bill_id"], APPROVER, created_at=now.isoformat())
    db.add_payment_run(other["bill_id"], APPROVER)

    client = as_user(db, ANALYST, UserRole.analyst)
    response = client.get(f"/bills/{bill['bill_id']}/payment-runs")

    assert response.status_code == 200
    assert [r["id"] for r in response.json()] == [new["run_id"], old["run_id"]]
    assert response.json()[1]["flag_reason"] == "Timed out."


def test_runs_name_whoever_started_them(db):
    bill = payable_bill(db)
    admin_id = str(uuid4())
    db.add_user(APPROVER, role="approver", full_name="Ana Approver")
    db.add_user(admin_id, role="admin", full_name="Ada Admin")
    now = datetime.now(UTC)
    first = db.add_payment_run(
        bill["bill_id"],
        APPROVER,
        status="flagged",
        flag_reason="Timed out.",
        started_at=now.isoformat(),
        finished_at=now.isoformat(),
        created_at=(now - timedelta(hours=1)).isoformat(),
    )
    second = db.add_payment_run(bill["bill_id"], admin_id, created_at=now.isoformat())

    # Read by an analyst, so the names come from app_users, not the viewer.
    client = as_user(db, ANALYST, UserRole.analyst)
    listed = client.get(f"/bills/{bill['bill_id']}/payment-runs").json()
    one = client.get(f"/payment-runs/{first['run_id']}").json()

    assert [(r["id"], r["started_by_name"]) for r in listed] == [
        (second["run_id"], "Ada Admin"),
        (first["run_id"], "Ana Approver"),
    ]
    assert one["started_by_name"] == "Ana Approver"


def test_a_renamed_starter_shows_their_current_name(db):
    bill = payable_bill(db)
    response = start(approver(db), bill)
    db.find("app_users", "user_id", APPROVER)["full_name"] = "Ana Renamed"

    run = approver(db).get(f"/payment-runs/{response.json()['id']}").json()

    assert run["started_by_name"] == "Ana Renamed"
    # The first step keeps the name the run was queued under.
    assert run["steps"][0]["detail"] == "Queued by Test approver."


def test_read_one_run_with_its_receipt(db):
    bill = payable_bill(db)
    now = datetime.now(UTC).isoformat()
    payment_id = str(uuid4())
    run = db.add_payment_run(
        bill["bill_id"],
        APPROVER,
        status="paid",
        started_at=now,
        finished_at=now,
        payment_id=payment_id,
        receipt={
            "confirmation_number": "PAY-123",
            "bill_number": "BILL-1001",
            "amount": "186.42",
            "paid_on": "2026-11-15",
            "outcome": "successful",
            "portal": "https://alder-creek-utility-demo.vercel.app",
        },
        steps=[{"at": now, "step": "pay", "detail": "Paying BILL-1001."}],
    )

    response = approver(db).get(f"/payment-runs/{run['run_id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "paid"
    assert body["payment_id"] == payment_id
    assert body["receipt"]["confirmation_number"] == "PAY-123"
    assert body["receipt"]["amount"] == "186.42"
    assert body["steps"][0]["detail"] == "Paying BILL-1001."


def test_run_of_an_unreadable_bill_is_404(db):
    bill = payable_bill(db, status="draft")  # the analyst's own draft
    run = db.add_payment_run(bill["bill_id"], ANALYST)

    response = approver(db).get(f"/payment-runs/{run['run_id']}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Payment run not found."


def test_unknown_run_is_404(db):
    assert approver(db).get(f"/payment-runs/{uuid4()}").status_code == 404


def test_listing_runs_of_an_unreadable_bill_is_404(db):
    bill = payable_bill(db, status="draft")

    response = approver(db).get(f"/bills/{bill['bill_id']}/payment-runs")

    assert response.status_code == 404

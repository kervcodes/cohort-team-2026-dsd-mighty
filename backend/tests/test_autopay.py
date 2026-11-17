"""Autopay (DC-86): `GET`/`PUT /autopay-settings`, and the payment run an
approval queues when autopay is on, against FakeSupabase. Who may call each
route at all is checked by the role table in test_route_permissions.py."""

import logging
from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

ADMIN = str(uuid4())
APPROVER = str(uuid4())
ANALYST = str(uuid4())
PASSWORD = "Portal-pw-Q7!x"

NAMES = {ADMIN: "Ada Admin", APPROVER: "Ana Approver", ANALYST: "Al Analyst"}
ROLES = {ADMIN: UserRole.admin, APPROVER: UserRole.approver, ANALYST: UserRole.analyst}


@pytest.fixture
def db():
    fake = FakeSupabase()
    for user_id, name in NAMES.items():
        fake.add_user(user_id, role=ROLES[user_id].value, full_name=name)
    with (
        patch("backend.api.autopay_settings.get_admin_supabase", return_value=fake),
        patch("backend.api.approvals.get_admin_supabase", return_value=fake),
        patch("backend.api.payment_runs.get_admin_supabase", return_value=fake),
    ):
        yield fake


def as_user(user_id: str) -> TestClient:
    user = make_user(user_id, role=ROLES[user_id])
    user.full_name = NAMES[user_id]
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def settings_row(db: FakeSupabase) -> dict:
    return db.tables["autopay_settings"][0]


def turn_on(db: FakeSupabase, limit: str = "500.00") -> None:
    settings_row(db).update(enabled=True, limit_amount=limit, updated_by=ADMIN)


# Settings


def test_autopay_is_off_with_no_limit_by_default(db):
    response = as_user(APPROVER).get("/autopay-settings")

    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["limit_amount"] is None
    assert body["updated_by"] is None
    assert body["updated_by_name"] is None
    assert body["updated_at"]


def test_admin_turns_autopay_on_with_a_limit(db):
    before = settings_row(db)["updated_at"]

    response = as_user(ADMIN).put(
        "/autopay-settings", json={"enabled": True, "limit_amount": "750.50"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["enabled"] is True
    assert body["limit_amount"] == "750.50"
    assert body["updated_by"] == ADMIN
    assert body["updated_by_name"] == "Ada Admin"
    assert body["updated_at"] >= before
    row = settings_row(db)
    assert (row["enabled"], row["limit_amount"], row["updated_by"]) == (
        True,
        "750.50",
        ADMIN,
    )
    # An approver reads the same setting back.
    assert as_user(APPROVER).get("/autopay-settings").json() == body


def test_turning_autopay_off_keeps_the_limit(db):
    turn_on(db)

    response = as_user(ADMIN).put(
        "/autopay-settings", json={"enabled": False, "limit_amount": "500.00"}
    )

    assert response.status_code == 200
    assert response.json()["enabled"] is False
    assert response.json()["limit_amount"] == "500.00"


def test_the_last_changer_is_shown_by_their_current_name(db):
    as_user(ADMIN).put(
        "/autopay-settings", json={"enabled": True, "limit_amount": "100"}
    )
    db.find("app_users", "user_id", ADMIN)["full_name"] = "Ada Renamed"

    assert as_user(APPROVER).get("/autopay-settings").json()["updated_by_name"] == (
        "Ada Renamed"
    )


def test_the_limit_is_given_in_cents_as_postgrest_sends_a_json_number(db):
    # PostgREST sends numeric(12,2) as a JSON number: 400.00 arrives as 400.0.
    settings_row(db).update(enabled=True, limit_amount=400.0, updated_by=ADMIN)

    response = as_user(ADMIN).get("/autopay-settings")

    assert response.status_code == 200
    assert response.json()["limit_amount"] == "400.00"


def test_turning_autopay_on_without_a_limit_is_422(db):
    response = as_user(ADMIN).put(
        "/autopay-settings", json={"enabled": True, "limit_amount": None}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Set a limit above $0 to turn on autopay."
    assert settings_row(db)["enabled"] is False
    assert settings_row(db)["updated_by"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"enabled": True, "limit_amount": "0"},
        {"enabled": True, "limit_amount": "-10"},
        {"enabled": False, "limit_amount": "0.00"},
        {"enabled": True, "limit_amount": "10.005"},
        {"enabled": True, "limit_amount": "12345678901.00"},
        {"enabled": True, "limit_amount": "lots"},
        {"enabled": True},
        {"limit_amount": "500"},
        {"enabled": True, "limit_amount": "500", "min_approvals": 2},
    ],
    ids=[
        "zero",
        "negative",
        "zero while off",
        "fractions of a cent",
        "over numeric(12,2)",
        "not a number",
        "no limit field",
        "no enabled field",
        "unknown field",
    ],
)
def test_a_bad_setting_is_422_and_changes_nothing(db, body):
    response = as_user(ADMIN).put("/autopay-settings", json=body)

    assert response.status_code == 422
    assert settings_row(db)["enabled"] is False
    assert settings_row(db)["limit_amount"] is None


def test_an_approver_cannot_change_the_setting(db):
    response = as_user(APPROVER).put(
        "/autopay-settings", json={"enabled": True, "limit_amount": "500"}
    )

    assert response.status_code == 403
    assert settings_row(db)["enabled"] is False


# Approval hook


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


def pending_bill(db: FakeSupabase, **fields) -> tuple[dict, dict]:
    """A bill awaiting approval, matched to a payable account, and its
    pending approval."""
    if "vendor_account" in fields:
        vendor_account = fields.pop("vendor_account")
    else:
        vendor_account = account(db)
    bill = db.add_bill(
        ANALYST,
        **{
            "status": "pending_approval",
            "amount": "186.42",
            "invoice_number": f"BILL-{uuid4().hex[:6]}",
            "vendor_account_id": (
                vendor_account["account_id"] if vendor_account else None
            ),
            **fields,
        },
    )
    return bill, db.add_approval(bill["bill_id"])


def approve(approval: dict, by: str = APPROVER):
    return as_user(by).post(
        f"/approvals/{approval['approval_id']}/decision", json={"decision": "approve"}
    )


def runs(db: FakeSupabase) -> list[dict]:
    return db.tables.get("payment_runs", [])


def assert_approved_without_a_run(db: FakeSupabase, response, bill: dict) -> None:
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "approved"
    assert db.find("bills", "bill_id", bill["bill_id"])["status"] == "approved"
    assert [r for r in runs(db) if r["bill_id"] == bill["bill_id"]] == []


@pytest.mark.parametrize("amount", ["186.42", "500.00"], ids=["under", "at the limit"])
def test_approval_under_the_limit_queues_an_autopay_run(db, amount):
    turn_on(db)
    bill, approval = pending_bill(db, amount=amount)

    response = approve(approval)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "approved"
    [run] = runs(db)
    assert run["bill_id"] == bill["bill_id"]
    assert run["status"] == "queued"
    assert run["trigger"] == "autopay"
    assert run["started_by"] == APPROVER
    assert [s["detail"] for s in run["steps"]] == [
        "Queued by autopay after approval by Ana Approver."
    ]


def test_the_autopay_run_reads_back_like_any_run(db):
    turn_on(db)
    bill, approval = pending_bill(db)
    approve(approval)

    listed = as_user(ANALYST).get(f"/bills/{bill['bill_id']}/payment-runs").json()

    assert [(r["trigger"], r["started_by_name"], r["status"]) for r in listed] == [
        ("autopay", "Ana Approver", "queued")
    ]


def test_an_admin_approving_a_big_bill_under_a_big_limit_queues_a_run(db):
    turn_on(db, limit="10000.00")
    _bill, approval = pending_bill(db, amount="7500.00")

    response = approve(approval, by=ADMIN)

    assert response.status_code == 200
    [run] = runs(db)
    assert (run["trigger"], run["started_by"]) == ("autopay", ADMIN)
    assert run["steps"][0]["detail"] == (
        "Queued by autopay after approval by Ada Admin."
    )


def test_approval_over_the_limit_queues_nothing(db, caplog):
    turn_on(db)
    bill, approval = pending_bill(db, amount="500.01")

    with caplog.at_level(logging.INFO, logger="backend.services.autopay"):
        response = approve(approval)

    assert_approved_without_a_run(db, response, bill)
    assert f"bill {bill['bill_id']}: over_limit" in caplog.text


def test_autopay_off_queues_nothing_even_with_a_limit(db):
    settings_row(db).update(enabled=False, limit_amount="500.00")
    bill, approval = pending_bill(db)

    assert_approved_without_a_run(db, approve(approval), bill)


def test_autopay_off_by_default_queues_nothing(db):
    bill, approval = pending_bill(db)

    assert_approved_without_a_run(db, approve(approval), bill)


def test_autopay_on_with_no_limit_queues_nothing(db):
    # The database refuses this row; autopay still treats it as off.
    settings_row(db).update(enabled=True, limit_amount=None)
    bill, approval = pending_bill(db)

    assert_approved_without_a_run(db, approve(approval), bill)


def test_a_bill_with_no_amount_queues_nothing(db):
    turn_on(db)
    bill, approval = pending_bill(db, amount=None)

    assert_approved_without_a_run(db, approve(approval), bill)


def test_an_unmatched_bill_queues_nothing(db, caplog):
    turn_on(db)
    bill, approval = pending_bill(db, vendor_account=None)

    with caplog.at_level(logging.INFO, logger="backend.services.autopay"):
        response = approve(approval)

    assert_approved_without_a_run(db, response, bill)
    assert "no_vendor_account" in caplog.text


def test_an_inactive_vendor_account_queues_nothing(db, caplog):
    turn_on(db)
    bill, approval = pending_bill(db, vendor_account=account(db, status="inactive"))

    with caplog.at_level(logging.INFO, logger="backend.services.autopay"):
        response = approve(approval)

    assert_approved_without_a_run(db, response, bill)
    assert "account_inactive" in caplog.text


@pytest.mark.parametrize(
    "missing",
    [{"password": None}, {"portal_url": None}, {"portal_login_email": None}],
    ids=["password", "portal_url", "email"],
)
def test_an_account_without_a_portal_login_queues_nothing(db, caplog, missing):
    turn_on(db)
    bill, approval = pending_bill(db, vendor_account=account(db, **missing))

    with caplog.at_level(logging.INFO, logger="backend.services.autopay"):
        response = approve(approval)

    assert_approved_without_a_run(db, response, bill)
    assert "no_portal_login" in caplog.text


def test_a_bill_with_an_active_run_gets_no_second_one(db, caplog):
    turn_on(db)
    bill, approval = pending_bill(db)
    existing = db.add_payment_run(
        bill["bill_id"],
        ADMIN,
        status="running",
        started_at=datetime.now(UTC).isoformat(),
    )

    with caplog.at_level(logging.INFO, logger="backend.services.autopay"):
        response = approve(approval)

    assert response.status_code == 200
    assert db.find("bills", "bill_id", bill["bill_id"])["status"] == "approved"
    assert runs(db) == [existing]
    assert "run_active" in caplog.text


def test_a_rejection_queues_nothing(db):
    turn_on(db)
    bill, approval = pending_bill(db)

    response = as_user(APPROVER).post(
        f"/approvals/{approval['approval_id']}/decision",
        json={"decision": "reject", "comments": "Wrong amount."},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert runs(db) == []


def test_a_refused_approval_queues_nothing(db):
    # Over $5,000: an approver may not approve it, so autopay never runs.
    turn_on(db, limit="10000.00")
    _bill, approval = pending_bill(db, amount="7500.00")

    response = approve(approval)

    assert response.status_code == 403
    assert runs(db) == []


@pytest.mark.parametrize(
    "broken",
    [
        "backend.services.autopay.get_autopay_settings",
        "backend.services.payment_run_queue.get_account",
        "backend.services.payment_run_queue.queue_run",
    ],
    ids=["reading the setting", "reading the account", "inserting the run"],
)
def test_an_error_while_queueing_leaves_the_approval_standing(db, caplog, broken):
    turn_on(db)
    bill, approval = pending_bill(db)
    error = APIError({"code": "XX000", "message": "connection reset"})

    with (
        patch(broken, side_effect=error),
        caplog.at_level(logging.INFO, logger="backend.services.autopay"),
    ):
        response = approve(approval)

    assert_approved_without_a_run(db, response, bill)
    assert db.find("approvals", "approval_id", approval["approval_id"])[
        "approval_status"
    ] == ("approved")
    assert "Autopay could not queue a run for bill" in caplog.text


def test_autopay_never_reads_or_logs_the_password(db, caplog):
    turn_on(db)
    _bill, approval = pending_bill(db)

    with caplog.at_level(logging.DEBUG):
        response = approve(approval)

    assert response.status_code == 200
    assert len(runs(db)) == 1
    assert "get_vendor_account_portal_login" not in db.rpc_calls
    assert PASSWORD not in caplog.text
    assert PASSWORD not in response.text

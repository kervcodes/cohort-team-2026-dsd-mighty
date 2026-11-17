"""Resubmit a rejected bill: POST /bills/{id}/resubmit updates the same bill,
keeps its rejected approval, and adds a new pending one. Runs the real route
and repository against FakeSupabase, which raises the SQL function's errors."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

USER_A = str(uuid4())
USER_B = str(uuid4())
FINAL = {
    "account_number_raw": "ACC-1",
    "invoice_number": "INV-100",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "4200.00",
}


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.bills.get_admin_supabase", return_value=fake):
        yield fake


def resubmit(bill_id: str, user_id: str = USER_A, role=UserRole.analyst):
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id, role=role)
    return TestClient(app).post(f"/bills/{bill_id}/resubmit", json=FINAL)


def test_resubmit_rejected_bill_creates_new_pending_approval(db):
    bill = db.add_bill(
        USER_A,
        status="rejected",
        amount="4500.00",
        document_path="bills/x/bill.pdf",
    )
    previous = db.add_approval(
        bill["bill_id"],
        approval_status="rejected",
        comments="Incorrect invoice amount",
    )

    response = resubmit(bill["bill_id"])

    assert response.status_code == 200, response.text
    assert response.json()["id"] == bill["bill_id"]
    (row,) = db.tables["bills"]
    assert (row["status"], row["amount"]) == ("pending_approval", "4200.00")
    assert row["document_path"] == "bills/x/bill.pdf"
    assert previous["approval_status"] == "rejected"
    statuses = sorted(a["approval_status"] for a in db.tables["approvals"])
    assert statuses == ["pending", "rejected"]


@pytest.mark.parametrize("role", [UserRole.analyst, UserRole.admin])
def test_resubmitting_another_users_bill_is_404_and_changes_nothing(db, role):
    bill = db.add_bill(USER_A, status="rejected", amount="4500.00")
    db.add_approval(bill["bill_id"], approval_status="rejected")

    response = resubmit(bill["bill_id"], USER_B, role)

    assert (response.status_code, response.json()) == (
        404,
        {"detail": "Bill not found."},
    )
    (row,) = db.tables["bills"]
    assert (row["status"], row["amount"]) == ("rejected", "4500.00")
    assert len(db.tables["approvals"]) == 1


def test_resubmitting_a_missing_bill_is_404(db):
    db.add_user(USER_A)

    assert resubmit(str(uuid4())).status_code == 404
    assert db.tables.get("approvals", []) == []


@pytest.mark.parametrize("status", ["draft", "pending_approval", "approved", "paid"])
def test_resubmitting_a_bill_that_is_not_rejected_is_409(db, status):
    bill = db.add_bill(USER_A, status=status, amount="4500.00")

    response = resubmit(bill["bill_id"])

    assert (response.status_code, response.json()) == (
        409,
        {"detail": "Only rejected bills can be resubmitted."},
    )
    (row,) = db.tables["bills"]
    assert (row["status"], row["amount"]) == (status, "4500.00")
    assert db.tables.get("approvals", []) == []

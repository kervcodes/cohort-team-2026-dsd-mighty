"""The bill writes that go through the approval functions (create, submit a
draft, resubmit) still match the bill to its vendor account, as the plain bill
writes do. Runs the real routes and repository against FakeSupabase."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

USER = str(uuid4())
FIELDS = {
    "account_number_raw": "ACC-1",
    "invoice_number": "INV-1",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "250.00",
}


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.bills.get_admin_supabase", return_value=fake):
        yield fake


@pytest.fixture
def account(db):
    vendor = db.add_vendor("Acme Water")
    prop = db.add_property()
    return db.add_vendor_account(prop["property_id"], vendor["vendor_id"])


def client() -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: make_user(
        USER, role=UserRole.analyst
    )
    return TestClient(app)


def test_create_matches_the_bill_to_its_vendor_account(db, account):
    response = client().post("/bills", json=FIELDS)

    assert response.status_code == 201, response.text
    (bill,) = db.tables["bills"]
    assert bill["vendor_account_id"] == account["account_id"]
    assert bill["vendor_id"] == account["vendor_id"]
    assert bill["property_id"] == account["property_id"]
    assert bill["vendor_account_picked"] is False


def test_submitting_a_draft_matches_the_bill_to_its_vendor_account(db, account):
    draft = db.add_bill(USER)

    response = client().post(f"/bills/{draft['bill_id']}/submit", json=FIELDS)

    assert response.status_code == 200, response.text
    assert draft["vendor_account_id"] == account["account_id"]
    assert draft["status"] == "pending_approval"


def test_resubmitting_matches_the_bill_to_its_vendor_account(db, account):
    rejected = db.add_bill(USER, status="rejected")

    response = client().post(f"/bills/{rejected['bill_id']}/resubmit", json=FIELDS)

    assert response.status_code == 200, response.text
    assert rejected["vendor_account_id"] == account["account_id"]
    assert rejected["status"] == "pending_approval"


def test_an_invoice_number_the_account_already_has_is_a_409(db, account):
    assert client().post("/bills", json=FIELDS).status_code == 201

    response = client().post("/bills", json={**FIELDS, "invoice_number": " inv-1"})

    assert response.status_code == 409, response.text
    assert len(db.tables["bills"]) == 1
    assert len(db.tables["approvals"]) == 1


def test_resubmitting_with_an_unusable_vendor_account_is_a_422(db):
    rejected = db.add_bill(USER, status="rejected")

    response = client().post(
        f"/bills/{rejected['bill_id']}/resubmit",
        json={**FIELDS, "vendor_account_id": str(uuid4())},
    )

    assert response.status_code == 422, response.text
    assert rejected["status"] == "rejected"

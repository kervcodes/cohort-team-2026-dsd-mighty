"""Create from a saved draft: POST /bills/{id}/submit sends that same draft,
with its stored PDF, for approval. Runs the real route and repository queries
against FakeSupabase, so the row filters are what is tested."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.bill import BillRead
from backend.schemas.user import UserRole

USER_A = str(uuid4())
USER_B = str(uuid4())
FINAL = {
    "account_number_raw": "ACC-1",
    "invoice_number": "INV-1",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "250.00",
    "description": "Water",
}


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.bills.get_admin_supabase", return_value=fake):
        yield fake


def as_user(user_id: str, role: UserRole = UserRole.analyst) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id, role=role)
    return TestClient(app)


def submit(bill_id: str, user_id: str = USER_A, role=UserRole.analyst, body=FINAL):
    return as_user(user_id, role).post(f"/bills/{bill_id}/submit", json=body)


def test_submit_sends_the_same_draft_for_approval_with_its_pdf(db):
    db.add_user(USER_A, full_name="Ada Analyst")
    draft = db.add_bill(
        USER_A,
        document_path="bills/x/bill.pdf",
        created_at="2026-11-01T00:00:00+00:00",
        amount="1.00",
        vendor_name_raw="Old Vendor",
        processing_notes="cleared in the form",
    )

    response = submit(draft["bill_id"])

    assert response.status_code == 200, response.text
    (row,) = db.tables["bills"]  # no second bill
    assert row["bill_id"] == draft["bill_id"]
    assert row["status"] == "pending_approval"
    assert row["amount"] == "250.00"
    assert row["invoice_number"] == "INV-1"
    assert row["description"] == "Water"
    # Fields the final form left empty are cleared, not kept from the draft.
    assert row["vendor_name_raw"] is None
    assert row["processing_notes"] is None
    assert row["document_path"] == "bills/x/bill.pdf"
    assert row["submitted_by"] == USER_A
    assert row["created_at"] == "2026-11-01T00:00:00+00:00"
    body = response.json()
    assert set(body) == set(BillRead.model_fields)
    assert body["id"] == draft["bill_id"]
    assert body["status"] == "pending_approval"
    assert body["document_path"] == "bills/x/bill.pdf"
    assert body["submitted_by"] == {"id": USER_A, "full_name": "Ada Analyst"}


@pytest.mark.parametrize("role", [UserRole.analyst, UserRole.admin])
def test_submitting_another_users_draft_is_404_and_changes_nothing(db, role):
    draft = db.add_bill(USER_A, amount="1.00")

    response = submit(draft["bill_id"], USER_B, role)

    assert (response.status_code, response.json()) == (
        404,
        {"detail": "Editable draft not found."},
    )
    (row,) = db.tables["bills"]
    assert (row["status"], row["amount"]) == ("draft", "1.00")


@pytest.mark.parametrize("role", [UserRole.analyst, UserRole.admin])
def test_another_users_submitted_bill_is_404_not_409(db, role):
    bill = db.add_bill(USER_A, status="pending_approval", amount="1.00")

    response = submit(bill["bill_id"], USER_B, role)

    assert response.status_code == 404
    assert db.tables["bills"][0]["amount"] == "1.00"


def test_a_bill_that_does_not_exist_is_404(db):
    db.add_user(USER_A)

    assert submit(str(uuid4())).status_code == 404
    assert db.tables.get("bills", []) == []


@pytest.mark.parametrize("status", ["pending_approval", "approved", "paid"])
def test_submitting_your_own_non_draft_is_409_and_changes_nothing(db, status):
    bill = db.add_bill(USER_A, status=status, amount="1.00")

    response = submit(bill["bill_id"])

    assert (response.status_code, response.json()) == (
        409,
        {"detail": "This bill has already been submitted."},
    )
    (row,) = db.tables["bills"]
    assert (row["status"], row["amount"]) == (status, "1.00")


def test_a_second_submit_is_409(db):
    draft = db.add_bill(USER_A)

    first = submit(draft["bill_id"])
    second = submit(draft["bill_id"], body={**FINAL, "amount": "999.00"})

    assert first.status_code == 200
    assert second.status_code == 409
    (row,) = db.tables["bills"]
    assert (row["status"], row["amount"]) == ("pending_approval", "250.00")


@pytest.mark.parametrize(
    "body",
    [
        {k: v for k, v in FINAL.items() if k != "amount"},  # a required field
        {**FINAL, "amount": "-5"},
        {**FINAL, "status": "approved"},  # not a field the caller sets
        {**FINAL, "submitted_by": USER_B},
    ],
    ids=["missing amount", "negative amount", "status", "submitted_by"],
)
def test_an_invalid_body_is_422_and_changes_nothing(db, body):
    draft = db.add_bill(USER_A)

    assert submit(draft["bill_id"], body=body).status_code == 422
    assert db.tables["bills"][0]["status"] == "draft"

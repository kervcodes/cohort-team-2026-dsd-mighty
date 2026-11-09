"""Who sees which bills: an analyst can read every submitted bill, but can
never change another analyst's bills or see their drafts.

Every bill route uses the service-role client, which bypasses row-level
security, so the filters from `bill_access`, applied by the repository, are
the only guard. These tests run the real routes and repository queries against
FakeSupabase, so removing a filter makes them fail.
"""

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
NEW_BILL = {
    "account_number_raw": "ACC-1",
    "invoice_number": "INV-1",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "250.00",
}
PDF = ("invoice.pdf", b"%PDF-1.4\nsample", "application/pdf")


@pytest.fixture
def db():
    fake = FakeSupabase()
    with (
        patch("backend.api.bills.get_admin_supabase", return_value=fake),
        patch("backend.api.bill_documents.get_admin_supabase", return_value=fake),
    ):
        yield fake


def as_user(user_id: str, role: UserRole = UserRole.analyst) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id, role=role)
    return TestClient(app)


def invoice_numbers(response) -> list[str]:
    assert response.status_code == 200, response.text
    return sorted(row["invoice_number"] for row in response.json())


def test_user_cannot_upload_to_another_users_draft(db):
    bill = db.add_bill(USER_A)

    response = as_user(USER_B).post(
        f"/bills/{bill['bill_id']}/document", files={"file": PDF}
    )

    assert response.status_code == 404
    assert db.storage.objects == {}
    assert db.tables["bills"][0]["document_path"] is None


def test_owner_can_upload_to_their_draft(db):
    bill = db.add_bill(USER_A)

    response = as_user(USER_A).post(
        f"/bills/{bill['bill_id']}/document", files={"file": PDF}
    )

    assert response.status_code == 201
    path = response.json()["document_path"]
    assert db.tables["bills"][0]["document_path"] == path
    assert path in db.storage.objects


def test_user_cannot_update_another_users_draft(db):
    bill = db.add_bill(USER_A, amount="100.00")

    response = as_user(USER_B).patch(
        f"/bills/{bill['bill_id']}/draft", json={"amount": "1.00"}
    )

    assert response.status_code == 404
    assert db.tables["bills"][0]["amount"] == "100.00"


def test_owner_can_update_their_draft(db):
    bill = db.add_bill(USER_A, amount="100.00")

    response = as_user(USER_A).patch(
        f"/bills/{bill['bill_id']}/draft", json={"amount": "275.00"}
    )

    assert response.status_code == 200
    assert db.tables["bills"][0]["amount"] == "275.00"


@pytest.mark.parametrize("path", ["/bills", "/bills/dashboard"])
def test_analyst_sees_only_their_own_bills_by_default(db, path):
    db.add_bill(USER_A, invoice_number="A-1", status="pending_approval")
    db.add_bill(USER_B, invoice_number="B-1", status="pending_approval")

    assert invoice_numbers(as_user(USER_B).get(path)) == ["B-1"]


@pytest.mark.parametrize("path", ["/bills", "/bills/dashboard"])
def test_analyst_sees_other_submitted_bills_with_scope_all(db, path):
    db.add_bill(USER_A, invoice_number="A-1", status="pending_approval")
    db.add_bill(USER_B, invoice_number="B-1", status="draft")

    response = as_user(USER_B).get(path, params={"scope": "all"})

    assert invoice_numbers(response) == ["A-1", "B-1"]


@pytest.mark.parametrize("role", [UserRole.approver, UserRole.admin])
@pytest.mark.parametrize("path", ["/bills", "/bills/dashboard"])
def test_approvers_and_admins_see_all_by_default_and_theirs_with_mine(db, path, role):
    db.add_bill(USER_A, invoice_number="A-1", status="approved")
    db.add_bill(USER_B, invoice_number="B-1", status="paid")
    approver = as_user(USER_B, role)

    assert invoice_numbers(approver.get(path)) == ["A-1", "B-1"]
    assert invoice_numbers(approver.get(path, params={"scope": "mine"})) == ["B-1"]


@pytest.mark.parametrize("role", list(UserRole))
@pytest.mark.parametrize("path", ["/bills", "/bills/dashboard"])
def test_nobody_sees_another_users_draft(db, path, role):
    db.add_bill(USER_A, invoice_number="A-draft")
    db.add_bill(USER_A, invoice_number="A-sent", status="pending_approval")

    response = as_user(USER_B, role).get(path, params={"scope": "all"})

    assert invoice_numbers(response) == ["A-sent"]


@pytest.mark.parametrize("path", ["/bills", "/bills/dashboard"])
def test_an_unknown_scope_is_422(db, path):
    assert as_user(USER_A).get(path, params={"scope": "everyone"}).status_code == 422


def test_bill_list_names_each_submitter(db):
    db.add_user(USER_A, full_name="Ada Analyst")
    db.add_bill(USER_A, status="pending_approval")

    (bill,) = as_user(USER_B).get("/bills", params={"scope": "all"}).json()

    assert bill["submitted_by"] == {"id": USER_A, "full_name": "Ada Analyst"}


def test_get_bill_returns_another_users_submitted_bill(db):
    db.add_user(USER_A, full_name="Ada Analyst")
    bill = db.add_bill(USER_A, status="pending_approval", invoice_number="A-1")

    response = as_user(USER_B).get(f"/bills/{bill['bill_id']}")

    assert response.status_code == 200
    assert response.json()["id"] == bill["bill_id"]
    assert response.json()["submitted_by"] == {"id": USER_A, "full_name": "Ada Analyst"}


@pytest.mark.parametrize("role", list(UserRole))
def test_get_bill_hides_another_users_draft_as_not_found(db, role):
    draft = db.add_bill(USER_A)
    reader = as_user(USER_B, role)

    hidden = reader.get(f"/bills/{draft['bill_id']}")
    missing = reader.get(f"/bills/{uuid4()}")

    # Same answer as a bill that does not exist, so existence does not leak.
    assert (hidden.status_code, hidden.json()) == (404, {"detail": "Bill not found."})
    assert (missing.status_code, missing.json()) == (404, {"detail": "Bill not found."})


def test_owner_can_read_their_own_empty_draft(db):
    draft = db.add_bill(USER_A)

    response = as_user(USER_A).get(f"/bills/{draft['bill_id']}")

    assert response.status_code == 200
    assert response.json()["status"] == "draft"
    assert response.json()["invoice_number"] is None


# Create (POST /bills) and Save draft share one save path.


def test_create_saves_the_bill_for_the_caller_pending_approval(db):
    db.add_user(USER_A, full_name="Ada Analyst")

    response = as_user(USER_A).post("/bills", json=NEW_BILL)

    assert response.status_code == 201, response.text
    (row,) = db.tables["bills"]
    assert row["submitted_by"] == USER_A
    assert row["status"] == "pending_approval"
    assert row["invoice_number"] == "INV-1"
    body = response.json()
    assert set(body) == set(BillRead.model_fields)
    assert body["id"] == row["bill_id"]
    assert body["status"] == "pending_approval"
    assert body["amount"] == "250.00"
    assert body["submitted_by"] == {"id": USER_A, "full_name": "Ada Analyst"}


def test_create_rejects_a_submitter_or_status_in_the_body(db):
    db.add_user(USER_A)
    body = {**NEW_BILL, "submitted_by": USER_B, "status": "approved"}

    assert as_user(USER_A).post("/bills", json=body).status_code == 422
    assert db.tables.get("bills", []) == []


def test_create_requires_sign_in(db):
    response = TestClient(app).post("/bills", json=NEW_BILL)

    assert response.status_code == 401
    assert db.tables.get("bills", []) == []


@pytest.mark.parametrize(
    ("role", "status"),
    [(UserRole.approver, "active"), (UserRole.analyst, "inactive")],
)
def test_create_requires_an_active_writer(db, role, status):
    app.dependency_overrides[get_current_user] = lambda: make_user(
        USER_A, role=role, status=status
    )

    response = TestClient(app).post("/bills", json=NEW_BILL)

    assert response.status_code == 403
    assert db.tables.get("bills", []) == []


def test_save_draft_stores_a_draft_for_the_caller(db):
    db.add_user(USER_A)

    response = as_user(USER_A).post("/bills/drafts", json={"amount": "12.00"})

    assert response.status_code == 201
    (row,) = db.tables["bills"]
    assert (row["submitted_by"], row["status"]) == (USER_A, "draft")
    assert response.json() == {
        "bill_id": row["bill_id"],
        "status": "draft",
        "document_path": None,
    }


def test_dashboard_returns_only_the_declared_columns(db):
    # A column the repository might select later must not reach the client.
    db.add_bill(USER_A, amount=250.5, processing_notes="internal", vendor_id="v1")

    (row,) = as_user(USER_A).get("/bills/dashboard").json()

    assert set(row) == {
        "bill_id",
        "invoice_number",
        "property_address",
        "vendor_name_raw",
        "invoice_date",
        "due_date",
        "amount",
        "status",
        "document_path",
        "created_at",
    }
    assert row["amount"] == 250.5


# Upload failures. Each runs the real route against FakeSupabase.


def upload(bill_id: str, file=PDF):
    return as_user(USER_A).post(f"/bills/{bill_id}/document", files={"file": file})


def test_upload_rejects_a_file_over_10_mib(db):
    bill = db.add_bill(USER_A)
    big = ("big.pdf", b"%PDF-" + b"0" * (10 * 1024 * 1024), "application/pdf")

    assert upload(bill["bill_id"], big).status_code == 413
    assert db.storage.objects == {}


def test_upload_rejects_a_non_pdf_content_type(db):
    bill = db.add_bill(USER_A)

    response = upload(bill["bill_id"], ("a.png", b"\x89PNG\r\n", "image/png"))

    assert response.status_code == 415
    assert db.storage.objects == {}


def test_upload_rejects_a_pdf_content_type_without_pdf_bytes(db):
    bill = db.add_bill(USER_A)

    response = upload(bill["bill_id"], ("a.pdf", b"not a pdf", "application/pdf"))

    assert response.status_code == 400
    assert db.storage.objects == {}


def test_upload_to_a_bill_that_already_has_a_document_is_409(db):
    bill = db.add_bill(USER_A, document_path="bills/x/existing.pdf")

    assert upload(bill["bill_id"]).status_code == 409
    assert db.storage.objects == {}


def test_storage_failure_is_503_and_attaches_nothing(db):
    bill = db.add_bill(USER_A)
    db.storage.fail_uploads = True

    assert upload(bill["bill_id"]).status_code == 503
    assert db.tables["bills"][0]["document_path"] is None


def test_stored_file_is_deleted_when_attaching_it_fails(db):
    bill = db.add_bill(USER_A)

    with patch(
        "backend.api.bill_documents.attach_document",
        side_effect=RuntimeError("database down"),
    ):
        response = upload(bill["bill_id"])

    assert response.status_code == 503
    assert len(db.storage.removed) == 1
    assert db.storage.objects == {}  # no orphaned file


def test_stored_file_is_deleted_when_the_draft_changed_during_upload(db):
    bill = db.add_bill(USER_A)

    # attach_document finds no matching draft (it was submitted meanwhile).
    with patch("backend.api.bill_documents.attach_document", return_value=None):
        response = upload(bill["bill_id"])

    assert response.status_code == 409
    assert len(db.storage.removed) == 1
    assert db.storage.objects == {}

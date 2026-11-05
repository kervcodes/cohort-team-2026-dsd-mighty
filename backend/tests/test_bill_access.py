"""Tenant isolation: one analyst can never read or change another's bills.

Every bill route uses the service-role client, which bypasses row-level
security, so the `submitted_by` filters in the repository are the only guard.
These tests run the real repository queries against FakeSupabase, so removing
a filter makes them fail.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user

USER_A = str(uuid4())
USER_B = str(uuid4())
PDF = ("invoice.pdf", b"%PDF-1.4\nsample", "application/pdf")


@pytest.fixture
def db():
    fake = FakeSupabase()
    with (
        patch("backend.api.bills.get_admin_supabase", return_value=fake),
        patch("backend.api.bill_documents.get_admin_supabase", return_value=fake),
    ):
        yield fake


def as_user(user_id: str) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id)
    return TestClient(app)


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


def test_dashboard_lists_only_the_callers_bills(db):
    db.add_bill(USER_A, invoice_number="A-1")
    db.add_bill(USER_B, invoice_number="B-1")

    rows = as_user(USER_B).get("/bills/dashboard").json()

    assert [row["invoice_number"] for row in rows] == ["B-1"]


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

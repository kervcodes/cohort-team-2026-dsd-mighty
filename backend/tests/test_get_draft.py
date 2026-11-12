# backend/tests/test_get_draft.py
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api import bills as bills_router  # adjust to your module path
from backend.app import app
from backend.auth import CurrentUser, get_current_user
from backend.schemas.user import UserRole

FAKE_DB = object()


def make_user(role=UserRole.analyst, status="active") -> CurrentUser:
    return CurrentUser(
        id=uuid4(),
        email="analyst@example.com",
        full_name="Test Analyst",
        role=role,
        status=status,
    )


@pytest.fixture
def user():
    return make_user()


@pytest.fixture
def client(monkeypatch, user):
    # Skip the Supabase token check and pretend this user is signed in.
    # require_active(...) still runs on top of this user, so the real
    # status/role logic is exercised.
    app.dependency_overrides[get_current_user] = lambda: user
    # Patch the names as the router imported them, not where they're defined.
    monkeypatch.setattr(bills_router, "get_admin_supabase", lambda: FAKE_DB)

    yield TestClient(app)

    app.dependency_overrides.clear()


def patch_repo(monkeypatch, return_value):
    mock = MagicMock(return_value=return_value)
    monkeypatch.setattr(bills_router, "get_editable_draft", mock)
    return mock


def test_returns_the_draft(client, monkeypatch, user):
    bill_id = uuid4()
    draft = {
        "bill_id": str(bill_id),
        "status": "draft",
        "account_number_raw": "ACC-100",
        "invoice_number": "INV-2001",
        "amount": "250.00",
        "document_path": None,
    }
    repo = patch_repo(monkeypatch, draft)

    response = client.get(f"/bills/{bill_id}/draft")

    assert response.status_code == 200
    body = response.json()
    assert {key: body[key] for key in draft} == draft
    repo.assert_called_once_with(client=FAKE_DB, bill_id=bill_id, user_id=str(user.id))


def test_returns_a_partial_draft_with_nulls_intact(client, monkeypatch):
    bill_id = uuid4()
    draft = {
        "bill_id": str(bill_id),
        "status": "draft",
        "account_number_raw": "ACC-100",
        "invoice_number": None,
        "due_date": None,
        "amount": None,
        "document_path": None,
    }
    patch_repo(monkeypatch, draft)

    body = client.get(f"/bills/{bill_id}/draft").json()

    assert body["account_number_raw"] == "ACC-100"
    # Nulls must stay as null, not be dropped, so the frontend can blank them.
    assert "due_date" in body and body["due_date"] is None
    assert body["amount"] is None


def test_returns_404_when_no_editable_draft(client, monkeypatch):
    # Covers: missing bill, someone else's bill, or a bill that's no longer a draft.
    patch_repo(monkeypatch, None)

    response = client.get(f"/bills/{uuid4()}/draft")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Editable draft not found."}


def test_rejects_a_malformed_bill_id(client, monkeypatch):
    repo = patch_repo(monkeypatch, None)

    response = client.get("/bills/not-a-uuid/draft")

    assert response.status_code == 422
    repo.assert_not_called()


def test_requires_authentication(monkeypatch):
    # No dependency override here, so the real get_current_user runs. With no
    # Authorization header it returns 401 before it ever calls Supabase.
    repo = patch_repo(monkeypatch, {"bill_id": "x"})

    response = TestClient(app).get(f"/bills/{uuid4()}/draft")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    repo.assert_not_called()


def test_rejects_an_account_that_is_not_active_yet(monkeypatch):
    # New: the old override skipped this check entirely.
    app.dependency_overrides[get_current_user] = lambda: make_user(status="inactive")
    monkeypatch.setattr(bills_router, "get_admin_supabase", lambda: FAKE_DB)
    repo = patch_repo(monkeypatch, {"bill_id": "x"})

    try:
        response = TestClient(app).get(f"/bills/{uuid4()}/draft")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json() == {"detail": "Your account is waiting for approval."}
    repo.assert_not_called()

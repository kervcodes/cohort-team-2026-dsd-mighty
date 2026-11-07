# backend/tests/test_get_draft.py
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api import bills as bills_router  # adjust to your module path
from backend.app import app
from backend.auth import require_active_analyst

USER_ID = "user-123"
FAKE_DB = object()


@pytest.fixture
def client(monkeypatch):
    # Skip real token checking and pretend this analyst is signed in.
    app.dependency_overrides[require_active_analyst] = lambda: USER_ID
    # Patch the names as the router imported them, not where they're defined.
    monkeypatch.setattr(bills_router, "get_admin_supabase", lambda: FAKE_DB)

    yield TestClient(app)

    app.dependency_overrides.clear()


def patch_repo(monkeypatch, return_value):
    mock = MagicMock(return_value=return_value)
    monkeypatch.setattr(bills_router, "get_editable_draft", mock)
    return mock


def test_returns_the_draft(client, monkeypatch):
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
    assert response.json() == draft
    repo.assert_called_once_with(client=FAKE_DB, bill_id=bill_id, user_id=USER_ID)


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

    # Temporary diagnostics: these run before the status check so they always show.
    print("override registered:", require_active_analyst in app.dependency_overrides)
    print("router module:", bills_router.get_draft.__module__)
    print(
        "app serves this router's get_draft:",
        any(getattr(r, "endpoint", None) is bills_router.get_draft for r in app.routes),
    )
    print("response:", response.status_code, response.text)

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Editable draft not found."}


def test_rejects_a_malformed_bill_id(client, monkeypatch):
    repo = patch_repo(monkeypatch, None)

    response = client.get("/bills/not-a-uuid/draft")

    assert response.status_code == 422
    repo.assert_not_called()


def test_requires_authentication(monkeypatch):
    # No dependency override here, so the real auth runs.
    repo = patch_repo(monkeypatch, {"bill_id": "x"})

    response = TestClient(app).get(f"/bills/{uuid4()}/draft")

    assert response.status_code in (401, 403)
    repo.assert_not_called()

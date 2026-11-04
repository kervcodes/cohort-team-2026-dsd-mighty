from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import require_active_analyst
from backend.schemas.bill import BillDraftCreate
from backend.services.bill_repository import update_draft

USER_ID = str(uuid4())


@pytest.fixture
def client():
    app.dependency_overrides[require_active_analyst] = lambda: USER_ID
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_update_draft_requires_authentication():
    response = TestClient(app).patch(f"/bills/{uuid4()}/draft", json={})

    assert response.status_code == 401


def test_update_draft_returns_updated_draft(client):
    bill_id = uuid4()
    row = {"bill_id": str(bill_id), "status": "draft", "document_path": None}

    with (
        patch("backend.api.bills.get_admin_supabase"),
        patch("backend.api.bills.update_draft", return_value=row) as mock_update,
    ):
        response = client.patch(
            f"/bills/{bill_id}/draft",
            json={"amount": "275.00", "invoice_number": None},
        )

    assert response.status_code == 200
    assert response.json()["bill_id"] == str(bill_id)
    sent = mock_update.call_args.kwargs
    assert sent["bill_id"] == bill_id
    assert sent["user_id"] == USER_ID


def test_update_draft_404_when_not_an_editable_draft(client):
    with (
        patch("backend.api.bills.get_admin_supabase"),
        patch("backend.api.bills.update_draft", return_value=None),
    ):
        response = client.patch(f"/bills/{uuid4()}/draft", json={"amount": "1.00"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Editable draft not found."


def test_update_draft_rejects_invalid_values(client):
    response = client.patch(f"/bills/{uuid4()}/draft", json={"amount": "-5"})

    assert response.status_code == 422


def test_update_draft_sends_explicit_nulls_but_not_unset_fields():
    db = MagicMock()
    query = db.table.return_value.update.return_value
    query.eq.return_value = query
    query.select.return_value = query
    query.execute.return_value.data = [
        {"bill_id": "b", "status": "draft", "document_path": None}
    ]

    draft = BillDraftCreate.model_validate({"amount": "275.00", "due_date": None})
    update_draft(db, uuid4(), USER_ID, draft)

    sent = db.table.return_value.update.call_args.args[0]
    assert sent == {"amount": "275.00", "due_date": None}
    # The update is scoped to the caller's own row and to drafts only.
    eq_calls = [c.args for c in query.eq.call_args_list]
    assert ("submitted_by", USER_ID) in eq_calls
    assert ("status", "draft") in eq_calls

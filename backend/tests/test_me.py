"""`GET /me`: any signed-in user learns who they are, active or not."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from current_users import make_user
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole


def as_user(user) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_active_user_gets_their_profile():
    user = make_user(role=UserRole.approver)

    response = as_user(user).get("/me")

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "role": "approver",
        "status": "active",
    }


def test_inactive_user_gets_their_profile_with_status_inactive():
    response = as_user(make_user(status="inactive")).get("/me")

    assert response.status_code == 200
    assert response.json()["status"] == "inactive"


def test_no_token_is_401():
    response = TestClient(app).get("/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


def test_user_without_a_profile_row_is_403():
    auth = MagicMock()
    auth.auth.get_user.return_value = SimpleNamespace(user=SimpleNamespace(id=uuid4()))
    admin = MagicMock()
    lookup = admin.table.return_value.select.return_value.eq.return_value
    lookup.maybe_single.return_value.execute.return_value = None

    with (
        patch("backend.auth.get_supabase", return_value=auth),
        patch("backend.auth.get_admin_supabase", return_value=admin),
    ):
        response = TestClient(app).get("/me", headers={"Authorization": "Bearer token"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Account not found. Contact an admin."

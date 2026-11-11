
"""The admin user routes read and update public.app_users through the repository.

Who may call each route is checked in test_route_permissions.py; these tests
cover what the routes do for a caller who is allowed.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from current_users import make_user
from fake_supabase import FakeSupabase

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole
from datetime import datetime


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.users.get_admin_supabase", return_value=fake):
        yield fake


@pytest.fixture
def admin(monkeypatch):
    monkeypatch.setitem(
        app.dependency_overrides,
        get_current_user,
        lambda: make_user(role=UserRole.admin),
    )
    return TestClient(app)


def test_list_requires_sign_in(db):
    response = TestClient(app).get("/admin/users")

    assert response.status_code == 401


def test_list_returns_users_sorted_newest_first(db, admin):
    older = db.add_user(
        str(uuid4()),
        full_name="Older User",
        email="older@example.com",
        created_at="2026-01-01T10:00:00+00:00",
    )

    newer = db.add_user(
        str(uuid4()),
        full_name="Newer User",
        email="newer@example.com",
        created_at="2026-02-01T10:00:00+00:00",
    )

    response = admin.get("/admin/users")

    assert response.status_code == 200

    body = response.json()

    assert [user["full_name"] for user in body] == [
        "Newer User",
        "Older User",
    ]

    assert body[0] == {
    "user_id": newer["user_id"],
    "full_name": "Newer User",
    "email": "newer@example.com",
    "role": "analyst",
    "status": "active",
    "created_at": body[0]["created_at"],
}

    assert datetime.fromisoformat(
        body[0]["created_at"].replace("Z", "+00:00")
    ) == datetime.fromisoformat(newer["created_at"])


def test_list_is_empty_when_there_are_no_users(db, admin):
    response = admin.get("/admin/users")

    assert response.status_code == 200
    assert response.json() == []


def test_list_returns_api_field_names(db, admin):
    user = db.add_user(
        str(uuid4()),
        full_name="Michael Test",
        email="michael@example.com",
        role="admin",
        status="inactive",
    )

    response = admin.get("/admin/users")

    assert response.status_code == 200

    returned_user = response.json()[0]

    assert returned_user["user_id"] == user["user_id"]
    assert "id" not in returned_user
    assert returned_user["full_name"] == "Michael Test"
    assert returned_user["email"] == "michael@example.com"
    assert returned_user["role"] == "admin"
    assert returned_user["status"] == "inactive"


def test_get_returns_one_user(db, admin):
    user = db.add_user(
        str(uuid4()),
        full_name="Jane Doe",
        email="jane@example.com",
        role="approver",
    )

    response = admin.get(f"/admin/users/{user['user_id']}")

    assert response.status_code == 200

    body = response.json()

    assert body["user_id"] == user["user_id"]
    assert body["full_name"] == "Jane Doe"
    assert body["email"] == "jane@example.com"
    assert body["role"] == "approver"
    assert body["status"] == "active"


def test_get_unknown_user_is_404(db, admin):
    response = admin.get(f"/admin/users/{uuid4()}")

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found."


def test_get_rejects_invalid_user_id(db, admin):
    response = admin.get("/admin/users/not-a-uuid")

    assert response.status_code == 422



def test_admin_changes_user_role(db, admin):
    user = db.add_user(
        str(uuid4()),
        full_name="Jane Doe",
        email="jane@example.com",
        role="analyst",
    )

    response = admin.patch(
        f"/admin/users/{user['user_id']}",
        json={"role": "approver"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "approver"

    assert db.tables["app_users"][0]["role"] == "approver"


def test_admin_changes_user_status(db, admin):
    user = db.add_user(
        str(uuid4()),
        full_name="Jane Doe",
        email="jane@example.com",
        status="active",
    )

    response = admin.patch(
        f"/admin/users/{user['user_id']}",
        json={"status": "inactive"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "inactive"

    assert db.tables["app_users"][0]["status"] == "inactive"


def test_admin_changes_user_role_and_status(db, admin):
    user = db.add_user(
        str(uuid4()),
        full_name="Jane Doe",
        email="jane@example.com",
        role="analyst",
        status="active",
    )

    response = admin.patch(
        f"/admin/users/{user['user_id']}",
        json={
            "role": "approver",
            "status": "inactive",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["role"] == "approver"
    assert body["status"] == "inactive"

    stored = db.tables["app_users"][0]

    assert stored["role"] == "approver"
    assert stored["status"] == "inactive"


def test_admin_can_reactivate_user(db, admin):
    user = db.add_user(
        str(uuid4()),
        status="inactive",
    )

    response = admin.patch(
        f"/admin/users/{user['user_id']}",
        json={"status": "active"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "active"


def test_update_unknown_user_is_404(db, admin):
    response = admin.patch(
        f"/admin/users/{uuid4()}",
        json={"role": "approver"},
    )

    assert response.status_code == 404


def test_admin_cannot_edit_own_account(db,monkeypatch):
    current_admin = make_user(role=UserRole.admin)

    monkeypatch.setitem(
            app.dependency_overrides,
            get_current_user,
            lambda: current_admin,
        )
    db.add_user(
        str(current_admin.id),
        role="admin",
    )

    response = TestClient(app).patch(
        f"/admin/users/{current_admin.id}",
        json={"role": "analyst"},
    )

    assert response.status_code == 403
    assert "You cannot edit your own account" in response.json()["detail"]

    assert db.tables["app_users"][0]["role"] == "admin"


def test_update_rejects_invalid_user_id(db, admin):
    response = admin.patch(
        "/admin/users/not-a-uuid",
        json={"role": "approver"},
    )

    assert response.status_code == 422



@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"role": None},
        {"status": None},
        {"role": "superadmin"},
        {"status": "pending"},
        {"role": "analyst", "status": "pending"},
        {"full_name": "Jane Doe"},
        {"role": "approver", "unknown_field": True},
    ],
    ids=[
        "empty payload",
        "null role",
        "null status",
        "invalid role",
        "invalid status",
        "invalid status with valid role",
        "self-update field",
        "unknown field",
    ],
)
def test_update_rejects_invalid_payloads(db, admin, payload):
    user = db.add_user(str(uuid4()))

    original = dict(user)

    response = admin.patch(
        f"/admin/users/{user['user_id']}",
        json=payload,
    )

    assert response.status_code == 422
    assert db.tables["app_users"][0] == original

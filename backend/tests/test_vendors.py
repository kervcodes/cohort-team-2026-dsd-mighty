"""The vendor routes read and write `public.vendors` through the repository.

Who may call each route is checked in test_route_permissions.py; these tests
cover what the routes do for a caller who is allowed.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.vendors.get_admin_supabase", return_value=fake):
        yield fake


@pytest.fixture
def admin():
    app.dependency_overrides[get_current_user] = lambda: make_user(role=UserRole.admin)
    return TestClient(app)


@pytest.fixture
def analyst():
    app.dependency_overrides[get_current_user] = lambda: make_user(
        role=UserRole.analyst
    )
    return TestClient(app)


def test_list_requires_sign_in(db):
    response = TestClient(app).get("/vendors")

    assert response.status_code == 401


def test_list_returns_vendors_sorted_by_name_with_api_field_names(db, analyst):
    zeta = db.add_vendor("Zeta Power", contact_email="billing@zeta.example")
    db.add_vendor("Acme Water", default_payment_method="ach")

    response = analyst.get("/vendors")

    assert response.status_code == 200
    body = response.json()
    assert [vendor["name"] for vendor in body] == ["Acme Water", "Zeta Power"]
    assert body[0]["default_payment_method"] == "ach"
    assert body[1] == {
        "id": zeta["vendor_id"],
        "name": "Zeta Power",
        "contact_email": "billing@zeta.example",
        "contact_phone": None,
        "default_payment_method": None,
        "created_at": body[1]["created_at"],
    }


def test_list_is_empty_when_there_are_no_vendors(db, analyst):
    response = analyst.get("/vendors")

    assert response.status_code == 200
    assert response.json() == []


def test_admin_creates_a_vendor_that_then_appears_in_the_list(db, admin):
    response = admin.post(
        "/vendors",
        json={
            "name": "Acme Water",
            "contact_email": "ap@acme.example",
            "contact_phone": "555-0100",
            "default_payment_method": "check",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Acme Water"
    assert created["default_payment_method"] == "check"

    stored = db.tables["vendors"][0]
    assert stored["vendor_name"] == "Acme Water"
    assert "name" not in stored
    assert stored["vendor_id"] == created["id"]

    assert admin.get("/vendors").json() == [created]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": ""},
        {"name": "Acme", "default_payment_method": "cash"},
        {"name": "Acme", "contact_email": "not-an-email"},
        {"name": "Acme", "vendor_name": "Acme"},
    ],
    ids=["no name", "empty name", "unknown method", "bad email", "unknown field"],
)
def test_create_rejects_invalid_vendors(db, admin, payload):
    response = admin.post("/vendors", json=payload)

    assert response.status_code == 422
    assert "vendors" not in db.tables


def test_get_returns_one_vendor(db, analyst):
    vendor = db.add_vendor("Acme Water")

    response = analyst.get(f"/vendors/{vendor['vendor_id']}")

    assert response.status_code == 200
    assert response.json()["name"] == "Acme Water"


def test_get_unknown_vendor_is_404(db, analyst):
    response = analyst.get(f"/vendors/{uuid4()}")

    assert response.status_code == 404


def test_admin_renames_a_vendor(db, admin):
    vendor = db.add_vendor("Acme Water")

    response = admin.patch(
        f"/vendors/{vendor['vendor_id']}", json={"name": "Acme Utilities"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Acme Utilities"
    assert db.tables["vendors"][0]["vendor_name"] == "Acme Utilities"


def test_update_unknown_vendor_is_404(db, admin):
    response = admin.patch(f"/vendors/{uuid4()}", json={"name": "Acme"})

    assert response.status_code == 404

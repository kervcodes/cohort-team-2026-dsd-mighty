"""The vendor account routes read and write `public.vendor_accounts`, and keep
the portal password in Vault, never in a response, log or error.

Who may call each route is checked in test_route_permissions.py; these tests
cover what the routes do for a caller who is allowed.
"""

import logging
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole
from backend.services.vendor_account_repository import get_portal_login

PASSWORD = "Portal-Pa55-do-not-leak"
NEW_PASSWORD = "Replaced-Pa55-do-not-leak"

READ_FIELDS = {
    "id",
    "property_id",
    "vendor_id",
    "account_number",
    "account_type",
    "payment_method",
    "portal_url",
    "portal_login_email",
    "portal_password_set",
    "status",
    "created_at",
}


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.vendor_accounts.get_admin_supabase", return_value=fake):
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


@pytest.fixture
def prop(db):
    return db.add_property()


@pytest.fixture
def vendor(db):
    return db.add_vendor("Acme Water")


def new_account(prop, vendor, **fields):
    return {
        "property_id": prop["property_id"],
        "vendor_id": vendor["vendor_id"],
        "account_number": "ACC-100",
        "account_type": "water",
        "payment_method": "ach",
        "portal_url": "https://pay.acme.example/login",
        "portal_login_email": "ap@elmcourt.example",
        **fields,
    }


def account_with_password(db, prop, vendor, password=PASSWORD, **fields):
    row = db.add_vendor_account(prop["property_id"], vendor["vendor_id"], **fields)
    db.rpc(
        "update_vendor_account",
        {
            "p_account_id": row["account_id"],
            "p_changes": {},
            "p_password_action": "set",
            "p_password": password,
        },
    ).execute()
    return row


def assert_no_secret(response, db):
    """No password, and no Vault secret id, in the response."""
    assert PASSWORD not in response.text
    assert NEW_PASSWORD not in response.text
    assert "secret" not in response.text
    for secret_id in db.vault:
        assert secret_id not in response.text


# CREATE


def test_create_stores_the_password_in_vault_and_never_returns_it(
    db, admin, prop, vendor
):
    response = admin.post(
        "/vendor-accounts", json=new_account(prop, vendor, portal_password=PASSWORD)
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == READ_FIELDS
    assert body["portal_password_set"] is True
    assert body["portal_login_email"] == "ap@elmcourt.example"
    assert body["status"] == "active"
    assert_no_secret(response, db)

    row = db.tables["vendor_accounts"][0]
    assert row["account_id"] == body["id"]
    assert PASSWORD not in str(row)
    assert db.vault == {row["portal_password_secret_id"]: PASSWORD}


def test_create_without_a_password_leaves_vault_alone(db, admin, prop, vendor):
    response = admin.post("/vendor-accounts", json=new_account(prop, vendor))

    assert response.status_code == 201
    assert response.json()["portal_password_set"] is False
    assert db.tables["vendor_accounts"][0]["portal_password_secret_id"] is None
    assert db.vault == {}


def test_create_duplicate_account_is_409_and_stores_nothing(db, admin, prop, vendor):
    db.add_vendor_account(
        prop["property_id"], vendor["vendor_id"], account_number="ACC-100"
    )

    response = admin.post(
        "/vendor-accounts", json=new_account(prop, vendor, portal_password=PASSWORD)
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "This vendor account already exists for the property."
    )
    assert len(db.tables["vendor_accounts"]) == 1
    assert db.vault == {}
    assert_no_secret(response, db)


def test_same_account_number_at_another_property_is_allowed(db, admin, prop, vendor):
    db.add_vendor_account(
        prop["property_id"], vendor["vendor_id"], account_number="ACC-100"
    )
    other = db.add_property("Oak Plaza")

    response = admin.post("/vendor-accounts", json=new_account(other, vendor))

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("missing", "detail"),
    [("property", "Property not found."), ("vendor", "Vendor not found.")],
)
def test_create_for_unknown_property_or_vendor_is_422(
    db, admin, prop, vendor, missing, detail
):
    payload = new_account(prop, vendor, portal_password=PASSWORD)
    payload[f"{missing}_id"] = str(uuid4())

    response = admin.post("/vendor-accounts", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"] == detail
    assert db.tables.get("vendor_accounts", []) == []
    assert db.vault == {}


def test_create_rolls_back_the_account_when_vault_fails(db, prop, vendor):
    app.dependency_overrides[get_current_user] = lambda: make_user(role=UserRole.admin)
    db.fail_vault_writes = True

    response = TestClient(app, raise_server_exceptions=False).post(
        "/vendor-accounts", json=new_account(prop, vendor, portal_password=PASSWORD)
    )

    assert response.status_code == 500
    assert PASSWORD not in response.text
    assert db.tables["vendor_accounts"] == []
    assert db.vault == {}


# VALIDATION ERRORS NEVER ECHO THE PASSWORD


@pytest.mark.parametrize(
    "fields",
    [
        {"account_number": None},
        {"payment_method": "cash"},
        {"portal_login_email": "not-an-email"},
        {"unknown_field": "x"},
        {"portal_password": PASSWORD * 20},
        {"portal_password": ""},
    ],
    ids=[
        "missing number",
        "unknown method",
        "bad email",
        "unknown field",
        "password too long",
        "empty password",
    ],
)
def test_create_422_never_contains_the_password(db, admin, prop, vendor, fields):
    payload = {**new_account(prop, vendor, portal_password=PASSWORD), **fields}
    payload = {key: value for key, value in payload.items() if value is not None}

    response = admin.post("/vendor-accounts", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"]
    assert PASSWORD not in response.text
    assert all("input" not in error for error in response.json()["detail"])
    assert db.tables.get("vendor_accounts", []) == []


@pytest.mark.parametrize(
    "fields",
    [
        {"account_number": None},
        {"status": "closed"},
        {"portal_password": PASSWORD * 20},
        {"id": "x"},
    ],
    ids=["null required field", "unknown status", "password too long", "extra"],
)
def test_patch_422_never_contains_the_password(db, admin, prop, vendor, fields):
    account = account_with_password(db, prop, vendor)

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}",
        json={"portal_password": NEW_PASSWORD, **fields},
    )

    assert response.status_code == 422
    assert PASSWORD not in response.text
    assert NEW_PASSWORD not in response.text
    assert db.vault == {account["portal_password_secret_id"]: PASSWORD}


def test_password_never_reaches_the_logs(db, admin, prop, vendor, caplog):
    caplog.set_level(logging.DEBUG)

    created = admin.post(
        "/vendor-accounts", json=new_account(prop, vendor, portal_password=PASSWORD)
    ).json()
    admin.patch(
        f"/vendor-accounts/{created['id']}", json={"portal_password": NEW_PASSWORD}
    )
    admin.post("/vendor-accounts", json={"portal_password": PASSWORD})

    assert caplog.records
    assert PASSWORD not in caplog.text
    assert NEW_PASSWORD not in caplog.text


# READ


def test_get_returns_the_account_with_password_set_flag(db, analyst, prop, vendor):
    with_password = account_with_password(db, prop, vendor, account_number="A-1")
    without = db.add_vendor_account(
        prop["property_id"], vendor["vendor_id"], account_number="A-2"
    )

    first = analyst.get(f"/vendor-accounts/{with_password['account_id']}")
    second = analyst.get(f"/vendor-accounts/{without['account_id']}")

    assert first.status_code == 200
    assert set(first.json()) == READ_FIELDS
    assert first.json()["portal_password_set"] is True
    assert second.json()["portal_password_set"] is False
    assert_no_secret(first, db)


def test_get_unknown_account_is_404(db, analyst):
    response = analyst.get(f"/vendor-accounts/{uuid4()}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Vendor account not found."


def test_list_returns_only_that_vendors_accounts_sorted_by_number(
    db, analyst, prop, vendor
):
    other_vendor = db.add_vendor("Zeta Power")
    account_with_password(db, prop, vendor, account_number="B-2")
    db.add_vendor_account(
        prop["property_id"], vendor["vendor_id"], account_number="A-1"
    )
    db.add_vendor_account(
        prop["property_id"], other_vendor["vendor_id"], account_number="C-3"
    )

    response = analyst.get(f"/vendors/{vendor['vendor_id']}/accounts")

    assert response.status_code == 200
    body = response.json()
    assert [account["account_number"] for account in body] == ["A-1", "B-2"]
    assert [account["portal_password_set"] for account in body] == [False, True]
    assert all(set(account) == READ_FIELDS for account in body)
    assert_no_secret(response, db)


def test_list_for_a_vendor_without_accounts_is_empty(db, analyst, vendor):
    response = analyst.get(f"/vendors/{vendor['vendor_id']}/accounts")

    assert response.status_code == 200
    assert response.json() == []


def test_list_for_an_unknown_vendor_is_404(db, analyst):
    response = analyst.get(f"/vendors/{uuid4()}/accounts")

    assert response.status_code == 404
    assert response.json()["detail"] == "Vendor not found."


# PATCH: omitted keeps the password, null clears it, a value replaces it


def test_patch_without_password_keeps_it(db, admin, prop, vendor):
    account = account_with_password(db, prop, vendor)
    secret_id = account["portal_password_secret_id"]

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}",
        json={"account_type": "sewer", "portal_login_email": "new@elmcourt.example"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["account_type"] == "sewer"
    assert body["portal_login_email"] == "new@elmcourt.example"
    assert body["portal_password_set"] is True
    assert account["portal_password_secret_id"] == secret_id
    assert db.vault == {secret_id: PASSWORD}


def test_patch_null_password_deletes_it_from_vault(db, admin, prop, vendor):
    account = account_with_password(db, prop, vendor)

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}", json={"portal_password": None}
    )

    assert response.status_code == 200
    assert response.json()["portal_password_set"] is False
    assert db.vault == {}
    assert account["portal_password_secret_id"] is None


def test_patch_password_replaces_it_in_the_same_secret(db, admin, prop, vendor):
    account = account_with_password(db, prop, vendor)
    secret_id = account["portal_password_secret_id"]

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}",
        json={"portal_password": NEW_PASSWORD},
    )

    assert response.status_code == 200
    assert response.json()["portal_password_set"] is True
    assert db.vault == {secret_id: NEW_PASSWORD}
    assert_no_secret(response, db)


def test_patch_sets_a_first_password(db, admin, prop, vendor):
    account = db.add_vendor_account(prop["property_id"], vendor["vendor_id"])

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}",
        json={"portal_password": PASSWORD},
    )

    assert response.status_code == 200
    assert response.json()["portal_password_set"] is True
    assert db.vault == {account["portal_password_secret_id"]: PASSWORD}


def test_patch_null_clears_optional_fields(db, admin, prop, vendor):
    account = db.add_vendor_account(
        prop["property_id"],
        vendor["vendor_id"],
        portal_url="https://pay.acme.example/",
        portal_login_email="ap@elmcourt.example",
    )

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}",
        json={"portal_url": None, "portal_login_email": None},
    )

    assert response.status_code == 200
    assert response.json()["portal_url"] is None
    assert response.json()["portal_login_email"] is None


@pytest.mark.parametrize(
    "payload",
    [{"account_type": "sewer"}, {"portal_password": PASSWORD}, {}],
    ids=["field", "password only", "empty"],
)
def test_patch_unknown_account_is_404(db, admin, payload):
    response = admin.patch(f"/vendor-accounts/{uuid4()}", json=payload)

    assert response.status_code == 404
    assert db.vault == {}


def test_patch_to_a_taken_account_number_is_409(db, admin, prop, vendor):
    db.add_vendor_account(prop["property_id"], vendor["vendor_id"], account_number="A")
    account = account_with_password(db, prop, vendor, account_number="B")

    response = admin.patch(
        f"/vendor-accounts/{account['account_id']}",
        json={"account_number": "A", "portal_password": NEW_PASSWORD},
    )

    assert response.status_code == 409
    assert account["account_number"] == "B"
    assert db.vault == {account["portal_password_secret_id"]: PASSWORD}


@pytest.mark.parametrize(
    "has_password", [True, False], ids=["replace password", "first password"]
)
def test_patch_changes_nothing_when_the_password_step_fails(
    db, prop, vendor, has_password
):
    # Columns and password change in one transaction: a new email must never
    # be saved next to the old password.
    app.dependency_overrides[get_current_user] = lambda: make_user(role=UserRole.admin)
    if has_password:
        account = account_with_password(
            db, prop, vendor, portal_login_email="old@elmcourt.example"
        )
    else:
        account = db.add_vendor_account(
            prop["property_id"],
            vendor["vendor_id"],
            portal_login_email="old@elmcourt.example",
        )
    row_before = dict(account)
    vault_before = dict(db.vault)
    db.fail_vault_writes = True

    response = TestClient(app, raise_server_exceptions=False).patch(
        f"/vendor-accounts/{account['account_id']}",
        json={
            "account_type": "sewer",
            "portal_login_email": "new@elmcourt.example",
            "portal_password": NEW_PASSWORD,
        },
    )

    assert response.status_code == 500
    assert NEW_PASSWORD not in response.text
    assert account == row_before
    assert db.vault == vault_before
    login = get_portal_login(db, account["account_id"])
    assert login is not None
    assert login.email == "old@elmcourt.example"


# SERVER-ONLY PORTAL LOGIN (for the payment agent)


def test_get_portal_login_returns_the_password_as_a_secret(db, prop, vendor):
    account = account_with_password(
        db,
        prop,
        vendor,
        portal_url="https://pay.acme.example/",
        portal_login_email="ap@elmcourt.example",
    )

    login = get_portal_login(db, account["account_id"])

    assert login is not None
    assert login.portal_url == "https://pay.acme.example/"
    assert login.email == "ap@elmcourt.example"
    assert login.password is not None
    assert login.password.get_secret_value() == PASSWORD
    assert PASSWORD not in repr(login)
    assert PASSWORD not in str(login)


def test_get_portal_login_without_password_or_account(db, prop, vendor):
    account = db.add_vendor_account(prop["property_id"], vendor["vendor_id"])

    login = get_portal_login(db, account["account_id"])

    assert login is not None
    assert login.password is None
    assert get_portal_login(db, uuid4()) is None


def test_no_route_returns_the_portal_login():
    # The payment agent reads it in-process; it is never served over HTTP.
    paths = app.openapi()["paths"]
    assert all("portal-login" not in path and "password" not in path for path in paths)

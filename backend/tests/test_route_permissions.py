"""Every bill route enforces the role table: who may call it, active only.

The table below is the rule, written out as data. Each case overrides
`get_current_user` only, so the routes' real `require_active` check runs, and
the routes run against FakeSupabase with a draft the caller owns, so an
allowed call succeeds end to end.
"""

from itertools import product
from unittest.mock import patch

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

ANALYST, APPROVER, ADMIN = UserRole.analyst, UserRole.approver, UserRole.admin
PDF = ("invoice.pdf", b"%PDF-1.4\nsample", "application/pdf")

# (method, path, roles allowed when active, status code when allowed)
ROLE_TABLE = [
    ("GET", "/bills/dashboard", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/bills/drafts", {ANALYST, ADMIN}, 201),
    ("PATCH", "/bills/{bill_id}/draft", {ANALYST, ADMIN}, 200),
    ("POST", "/bills/{bill_id}/document", {ANALYST, ADMIN}, 201),
]

# Routes that need a signed-in user but no role.
ANY_SIGNED_IN = {("GET", "/me")}

REQUEST_BODY = {
    "/bills/drafts": {"json": {"amount": "10.00"}},
    "/bills/{bill_id}/draft": {"json": {"amount": "10.00"}},
    "/bills/{bill_id}/document": {"files": {"file": PDF}},
}

CASES = [
    pytest.param(
        method,
        path,
        role,
        status,
        expected if role in allowed and status == "active" else 403,
        id=f"{method} {path} {role} {status}",
    )
    for (method, path, allowed, expected), role, status in product(
        ROLE_TABLE, UserRole, ("active", "inactive")
    )
]


@pytest.fixture
def db():
    fake = FakeSupabase()
    with (
        patch("backend.api.bills.get_admin_supabase", return_value=fake),
        patch("backend.api.bill_documents.get_admin_supabase", return_value=fake),
    ):
        yield fake


@pytest.mark.parametrize(("method", "path", "role", "status", "expected"), CASES)
def test_route_allows_only_its_active_roles(db, method, path, role, status, expected):
    user = make_user(role=role, status=status)
    bill = db.add_bill(str(user.id))
    app.dependency_overrides[get_current_user] = lambda: user

    response = TestClient(app).request(
        method,
        path.format(bill_id=bill["bill_id"]),
        **REQUEST_BODY.get(path, {}),
    )

    assert response.status_code == expected, response.text
    if status == "inactive":
        assert response.json()["detail"] == "Your account is waiting for approval."
    elif expected == 403:
        assert response.json()["detail"] == "Your role can't do this."


# The in-memory bill routes still need no sign-in; DC-39b moves them to
# Supabase behind the role table and empties this set.
UNGUARDED_BILL_ROUTES = {
    ("POST", "/bills"),
    ("GET", "/bills"),
    ("GET", "/bills/{bill_id}"),
}


def operations() -> dict[tuple[str, str], bool]:
    """(method, path) -> whether the route reads the bearer token, which the
    OpenAPI schema shows as a security scheme."""
    return {
        (method.upper(), path): bool(operation.get("security"))
        for path, ops in app.openapi()["paths"].items()
        for method, operation in ops.items()
    }


def test_every_signed_in_route_is_in_the_role_table():
    # A new route that reads the token fails here until it gets a row.
    guarded = {route for route, signed_in in operations().items() if signed_in}

    table = {(method, path) for method, path, _, _ in ROLE_TABLE}
    assert guarded == table | ANY_SIGNED_IN


def test_no_bill_route_skips_sign_in():
    # The dangerous mistake is a new bill route with no auth at all, which the
    # test above cannot see.
    unguarded = {
        route
        for route, signed_in in operations().items()
        if route[1].startswith("/bills") and not signed_in
    }

    assert unguarded == UNGUARDED_BILL_ROUTES

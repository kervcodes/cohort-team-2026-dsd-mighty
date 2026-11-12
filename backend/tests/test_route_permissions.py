"""Every bill and vendor route enforces the role table: who may call it, active only.

The table below is the rule, written out as data. Each case overrides
`get_current_user` only, so the routes' real `require_active` check runs, and
the routes run against FakeSupabase with a draft the caller owns, so an
allowed call succeeds end to end.

Every other route either needs sign-in or is listed in OPEN_ROUTES with a
reason. The admin Supabase client (secret key) bypasses RLS, so a route that
skips sign-in and uses it would serve data to anyone.
"""

from itertools import product
from unittest.mock import patch

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.api.bill_extraction import get_bill_extractor
from backend.app import app
from backend.auth import get_current_user
from backend.extraction.schema import ExtractionResult, ExtractionStatus
from backend.schemas.user import UserRole

ANALYST, APPROVER, ADMIN = UserRole.analyst, UserRole.approver, UserRole.admin
PDF = ("invoice.pdf", b"%PDF-1.4\nsample", "application/pdf")

# (method, path, roles allowed when active, status code when allowed)
ROLE_TABLE = [
    ("POST", "/bills", {ANALYST, ADMIN}, 201),
    ("GET", "/bills", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/bills/{bill_id}", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/bills/dashboard", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/bills/drafts", {ANALYST, ADMIN}, 201),
    ("GET", "/bills/{bill_id}/draft", {ANALYST, ADMIN}, 200),
    ("PATCH", "/bills/{bill_id}/draft", {ANALYST, ADMIN}, 200),
    ("POST", "/bills/{bill_id}/document", {ANALYST, ADMIN}, 201),
    ("POST", "/bills/extract", {ANALYST, ADMIN}, 200),
    ("GET", "/vendors", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/vendors", {ADMIN}, 201),
    ("GET", "/vendors/{vendor_id}", {ANALYST, APPROVER, ADMIN}, 200),
    ("PATCH", "/vendors/{vendor_id}", {ADMIN}, 200),
    ("GET", "/admin/users", {ADMIN}, 200),
]

# Routes that need a signed-in user but no role.
ANY_SIGNED_IN = {("GET", "/me")}

REQUEST_BODY = {
    ("POST", "/bills"): {
        "json": {
            "account_number_raw": "ACC-1",
            "invoice_number": "INV-1",
            "invoice_date": "2026-11-01",
            "due_date": "2026-12-01",
            "amount": "10.00",
        }
    },
    ("POST", "/bills/drafts"): {"json": {"amount": "10.00"}},
    ("PATCH", "/bills/{bill_id}/draft"): {"json": {"amount": "10.00"}},
    ("POST", "/bills/{bill_id}/document"): {"files": {"file": PDF}},
    ("POST", "/bills/extract"): {"files": {"file": PDF}},
    ("POST", "/vendors"): {"json": {"name": "Acme Water"}},
    ("PATCH", "/vendors/{vendor_id}"): {"json": {"contact_phone": "555-0100"}},
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
        patch("backend.api.vendors.get_admin_supabase", return_value=fake),
        patch("backend.api.users.get_admin_supabase", return_value=fake),
    ):
        yield fake


@pytest.fixture
def no_model_call():
    # POST /bills/extract reads the file with a stand-in, never a model.
    result = ExtractionResult(status=ExtractionStatus.ready_for_review)
    app.dependency_overrides[get_bill_extractor] = lambda: lambda data, media: result


@pytest.mark.parametrize(("method", "path", "role", "status", "expected"), CASES)
def test_route_allows_only_its_active_roles(
    db, no_model_call, method, path, role, status, expected
):
    user = make_user(role=role, status=status)
    db.add_user(
        str(user.id),
        role=role.value,
        status=status,
    )
    bill = db.add_bill(str(user.id))
    vendor = db.add_vendor("Acme Water")
    app.dependency_overrides[get_current_user] = lambda: user

    response = TestClient(app).request(
        method,
        path.format(bill_id=bill["bill_id"], vendor_id=vendor["vendor_id"]),
        **REQUEST_BODY.get((method, path), {}),
    )

    assert response.status_code == expected, response.text
    if status == "inactive":
        assert response.json()["detail"] == "Your account is waiting for approval."
    elif expected == 403:
        assert response.json()["detail"] == "Your role can't do this."


# Routes open on purpose: no sign-in at all. Each group says why and which
# ticket closes it. A route here must never use the admin Supabase client.
OPEN_ROUTES = {
    # Health check; stays open.
    ("GET", "/"),
    # Health check for Render and the team; publishable client only, so RLS
    # applies (test_health.py checks it never uses the admin client).
    ("GET", "/health"),
    # In-memory stubs; DC-43 (approve and reject actions) adds the role check.
    ("GET", "/approvals"),
    ("POST", "/approvals/{approval_id}/decision"),
    # In-memory stubs, no Supabase; must get a role-table row before they touch
    # Supabase.
    ("POST", "/vendor-accounts"),
    ("GET", "/vendor-accounts/{account_id}"),
    ("PATCH", "/vendor-accounts/{account_id}"),
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


def test_every_route_needs_sign_in_or_is_open_on_purpose():
    # The test above cannot see a new route with no auth at all; this one can.
    unguarded = {route for route, signed_in in operations().items() if not signed_in}

    assert unguarded == OPEN_ROUTES, (
        f"Open but not in OPEN_ROUTES: {sorted(unguarded - OPEN_ROUTES)}. "
        "Add require_active(...) and a ROLE_TABLE row, or add the route to "
        "OPEN_ROUTES with a reason. "
        f"In OPEN_ROUTES but signed in now: {sorted(OPEN_ROUTES - unguarded)}. "
        "Remove them from OPEN_ROUTES."
    )

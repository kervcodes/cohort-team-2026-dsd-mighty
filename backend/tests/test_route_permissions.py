"""Every bill, payment, payment run, vendor, vendor account and property route
enforces the role table.

Who may call each route, active users only.

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
    # Bills
    ("POST", "/bills", {ANALYST, ADMIN}, 201),
    ("GET", "/bills", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/bills/{bill_id}", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/bills/dashboard", {ANALYST, APPROVER, ADMIN}, 200),
    # Drafts
    ("POST", "/bills/drafts", {ANALYST, ADMIN}, 201),
    ("GET", "/bills/{bill_id}/draft", {ANALYST, ADMIN}, 200),
    ("PATCH", "/bills/{bill_id}/draft", {ANALYST, ADMIN}, 200),
    # Bill documents
    ("GET", "/bills/{bill_id}/document", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/bills/{bill_id}/document", {ANALYST, ADMIN}, 201),
    # Bill submission and extraction
    ("POST", "/bills/{bill_id}/submit", {ANALYST, ADMIN}, 200),
    ("POST", "/bills/extract", {ANALYST, ADMIN}, 200),
    ("POST", "/bills/{bill_id}/resubmit", {ANALYST, ADMIN}, 200),
    # Vendors
    ("POST", "/bills/{bill_id}/payments", {APPROVER, ADMIN}, 201),
    ("GET", "/bills/{bill_id}/payments", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/bills/{bill_id}/payment-runs", {APPROVER, ADMIN}, 201),
    ("GET", "/bills/{bill_id}/payment-runs", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/payment-runs/{run_id}", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/vendors", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/vendors", {ADMIN}, 201),
    ("GET", "/vendors/{vendor_id}", {ANALYST, APPROVER, ADMIN}, 200),
    ("PATCH", "/vendors/{vendor_id}", {ADMIN}, 200),
    # Vendor accounts
    ("GET", "/vendors/{vendor_id}/accounts", {ANALYST, APPROVER, ADMIN}, 200),
    ("GET", "/vendor-accounts", {ANALYST, APPROVER, ADMIN}, 200),
    ("POST", "/vendor-accounts", {ADMIN}, 201),
    ("GET", "/vendor-accounts/{account_id}", {ANALYST, APPROVER, ADMIN}, 200),
    ("PATCH", "/vendor-accounts/{account_id}", {ADMIN}, 200),
    # Properties
    ("GET", "/properties", {ANALYST, APPROVER, ADMIN}, 200),
    # Approvals
    ("GET", "/approvals", {APPROVER, ADMIN}, 200),
    ("POST", "/approvals/{approval_id}/decision", {APPROVER, ADMIN}, 200),
    # Admin users
    ("GET", "/admin/users", {ADMIN}, 200),
    ("GET", "/admin/users/{user_id}", {ADMIN}, 200),
    ("PATCH", "/admin/users/{user_id}", {ADMIN}, 200),
]


# Routes that need a signed-in user but no role.
ANY_SIGNED_IN = {("GET", "/me")}


NEW_BILL = {
    "account_number_raw": "ACC-1",
    "invoice_number": "INV-1",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "10.00",
}


# {placeholders} are filled with the ids of the rows the test creates.
REQUEST_BODY = {
    ("POST", "/bills"): {"json": NEW_BILL},
    ("POST", "/bills/{bill_id}/submit"): {"json": NEW_BILL},
    ("POST", "/bills/drafts"): {"json": {"amount": "10.00"}},
    ("PATCH", "/bills/{bill_id}/draft"): {"json": {"amount": "10.00"}},
    ("POST", "/bills/{bill_id}/document"): {"files": {"file": PDF}},
    ("POST", "/bills/extract"): {"files": {"file": PDF}},
    ("POST", "/bills/{bill_id}/payments"): {
        "json": {
            "amount": "10.00",
            "payment_method": "ach",
            "paid_on": "2026-11-01",
            "outcome": "completed",
        }
    },
    ("POST", "/vendors"): {"json": {"name": "Acme Water"}},
    ("PATCH", "/vendors/{vendor_id}"): {"json": {"contact_phone": "555-0100"}},
    ("POST", "/vendor-accounts"): {
        "json": {
            "property_id": "{property_id}",
            "vendor_id": "{vendor_id}",
            "account_number": "ACC-2",
            "account_type": "water",
            "payment_method": "ach",
            "portal_password": "hunter2-portal",
        }
    },
    ("PATCH", "/vendor-accounts/{account_id}"): {
        "json": {"account_type": "sewer", "portal_password": "hunter2-portal"}
    },
    ("POST", "/approvals/{approval_id}/decision"): {
        "json": {
            "decision": "approve",
        }
    },
    ("POST", "/bills/{bill_id}/resubmit"): {
        "json": {
            "account_number_raw": "ACC-1",
            "invoice_number": "INV-1",
            "invoice_date": "2026-11-01",
            "due_date": "2026-12-01",
            "amount": "10.00",
        }
    },
    ("PATCH", "/admin/users/{user_id}"): {"json": {"role": "approver"}},
}

# The caller's bill is a draft unless the route needs another state.
# {placeholders} are filled with the ids of the rows the test creates.
BILL_FIELDS = {
    ("POST", "/bills/{bill_id}/payments"): {"status": "approved", "amount": "10.00"},
    ("POST", "/bills/{bill_id}/payment-runs"): {
        "status": "approved",
        "amount": "10.00",
        "vendor_account_id": "{account_id}",
    },
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
        ROLE_TABLE,
        UserRole,
        ("active", "inactive"),
    )
]


@pytest.fixture
def db():
    fake = FakeSupabase()

    # The document route needs an existing PDF to generate a signed URL.
    fake.storage.objects["bills/test/invoice.pdf"] = PDF[1]

    with (
        patch("backend.api.bills.get_admin_supabase", return_value=fake),
        patch("backend.api.bill_documents.get_admin_supabase", return_value=fake),
        patch("backend.api.vendors.get_admin_supabase", return_value=fake),
        patch("backend.api.vendor_accounts.get_admin_supabase", return_value=fake),
        patch("backend.api.properties.get_admin_supabase", return_value=fake),
        patch("backend.api.users.get_admin_supabase", return_value=fake),
        patch("backend.api.approvals.get_admin_supabase", return_value=fake),
        patch("backend.api.payments.get_admin_supabase", return_value=fake),
        patch("backend.api.payment_runs.get_admin_supabase", return_value=fake),
    ):
        yield fake


@pytest.fixture
def no_model_call(monkeypatch):
    """Replace the extraction dependency without making a model call."""
    result = ExtractionResult(status=ExtractionStatus.ready_for_review)

    monkeypatch.setitem(
        app.dependency_overrides,
        get_bill_extractor,
        lambda: lambda data, media: result,
    )


@pytest.mark.parametrize(
    ("method", "path", "role", "status", "expected"),
    CASES,
)
def test_route_allows_only_its_active_roles(
    db,
    no_model_call,
    monkeypatch,
    method,
    path,
    role,
    status,
    expected,
):
    user = make_user(role=role, status=status)

    db.add_user(
        str(user.id),
        role=role.value,
        status=status,
    )

    vendor = db.add_vendor("Acme Water")
    prop = db.add_property()
    # With a portal login, so the account can be paid by a payment run.
    account = db.add_vendor_account(
        prop["property_id"],
        vendor["vendor_id"],
        portal_url="https://acme-water.example.com",
        portal_login_email="ap@example.com",
    )
    db.rpc(
        "update_vendor_account",
        {
            "p_account_id": account["account_id"],
            "p_changes": {},
            "p_password_action": "set",
            "p_password": "hunter2-portal",
        },
    ).execute()

    ids = {
        "vendor_id": vendor["vendor_id"],
        "property_id": prop["property_id"],
        "account_id": account["account_id"],
    }

    # The document route needs a stored PDF to sign a URL for.
    document_path = (
        "bills/test/invoice.pdf"
        if method == "GET" and path == "/bills/{bill_id}/document"
        else None
    )

    # Seed the bill in the state the route under test requires.
    if path == "/bills/{bill_id}/resubmit":
        bill_status = "rejected"
    elif path in {
        "/approvals",
        "/approvals/{approval_id}/decision",
    }:
        bill_status = "pending_approval"
    else:
        bill_status = "draft"

    bill_fields = {
        key: value.format(**ids) if isinstance(value, str) else value
        for key, value in BILL_FIELDS.get((method, path), {}).items()
    }

    # One bill only: state first, then any per-route overrides.
    bill = db.add_bill(
        str(user.id),
        **{
            "status": bill_status,
            "document_path": document_path,
            **bill_fields,
        },
    )
    ids["bill_id"] = bill["bill_id"]

    approval = None

    if path != "/bills/{bill_id}/submit":
        approval = db.add_approval(bill["bill_id"])

    # Resubmission must start with a rejected approval record.
    if path == "/bills/{bill_id}/resubmit":
        approval["approval_status"] = "rejected"

    if approval is not None:
        ids["approval_id"] = approval["approval_id"]

    if "{run_id}" in path:
        ids["run_id"] = db.add_payment_run(bill["bill_id"], str(user.id))["run_id"]

    target_user = db.add_user(
        "00000000-0000-0000-0000-000000000001",
        full_name="Target User",
        email="target@example.com",
        role="analyst",
        status="active",
    )

    monkeypatch.setitem(
        app.dependency_overrides,
        get_current_user,
        lambda: user,
    )

    request = REQUEST_BODY.get((method, path), {})

    if "json" in request:
        json = {
            key: value.format(**ids) if isinstance(value, str) else value
            for key, value in request["json"].items()
        }
        request = {**request, "json": json}

    response = TestClient(app).request(
        method,
        path.format(**ids, user_id=target_user["user_id"]),
        **request,
    )

    assert response.status_code == expected, response.text

    if status == "inactive":
        assert response.json()["detail"] == ("Your account is waiting for approval.")
    elif expected == 403:
        assert response.json()["detail"] == "Your role can't do this."


# Routes open on purpose: no sign-in at all.
# A route here must never use the admin Supabase client.
OPEN_ROUTES = {
    # Health check; stays open.
    ("GET", "/"),
    # Health check for Render and the team.
    # Uses the publishable client, so RLS applies.
    # test_health.py checks that it never uses the admin client.
    ("GET", "/health"),
}


def operations() -> dict[tuple[str, str], bool]:
    """(method, path) -> whether the route reads the bearer token.

    The OpenAPI schema exposes this through its security scheme.
    """
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
    # The first test cannot see a new route with no auth at all.
    # This test catches those routes.
    unguarded = {route for route, signed_in in operations().items() if not signed_in}

    assert unguarded == OPEN_ROUTES, (
        f"Open but not in OPEN_ROUTES: "
        f"{sorted(unguarded - OPEN_ROUTES)}. "
        "Add require_active(...) and a ROLE_TABLE row, or add the route "
        "to OPEN_ROUTES with a reason. "
        f"In OPEN_ROUTES but signed in now: "
        f"{sorted(OPEN_ROUTES - unguarded)}. "
        "Remove them from OPEN_ROUTES."
    )

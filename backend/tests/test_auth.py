"""`get_current_user` and `require_active`: who gets in, and what a failure
looks like."""

import logging
from itertools import product
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from current_users import make_user
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from supabase_auth.errors import AuthApiError, AuthRetryableError

from backend.app import app
from backend.auth import CurrentUser, get_current_user, require_active
from backend.schemas.user import UserRole

USER_ID = uuid4()
TOKEN = HTTPAuthorizationCredentials(scheme="Bearer", credentials="secret-token")
PROFILE = {
    "email": "approver@example.test",
    "full_name": "Test Approver",
    "role": "approver",
    "status": "inactive",
}


def auth_client(user=SimpleNamespace(id=USER_ID), error=None):
    client = MagicMock()
    if error is not None:
        client.auth.get_user.side_effect = error
    else:
        client.auth.get_user.return_value = SimpleNamespace(user=user)
    return client


def admin_client(row=None, *, error=None, no_match=False):
    """`app_users` lookup returning `row`, nothing, or raising `error`."""
    client = MagicMock()
    lookup = client.table.return_value.select.return_value.eq.return_value
    execute = lookup.maybe_single.return_value.execute
    if error is not None:
        execute.side_effect = error
    elif no_match:
        execute.return_value = None  # supabase-py's maybe_single() on no row
    else:
        execute.return_value = SimpleNamespace(data=row)
    return client


def check(auth=None, admin=None, credentials=TOKEN):
    with (
        patch("backend.auth.get_supabase", return_value=auth or auth_client()),
        patch("backend.auth.get_admin_supabase", return_value=admin or admin_client()),
    ):
        return get_current_user(credentials)


def failure(**kwargs) -> tuple[int, str]:
    with pytest.raises(HTTPException) as exc:
        check(**kwargs)
    return exc.value.status_code, exc.value.detail


# get_current_user


def test_signed_in_user_gets_their_profile_whatever_their_status():
    admin = admin_client(PROFILE)

    assert check(admin=admin) == CurrentUser(id=USER_ID, **PROFILE)
    lookup = admin.table.return_value.select.return_value.eq
    lookup.assert_called_once_with("user_id", str(USER_ID))


def test_missing_token_is_401():
    assert failure(credentials=None) == (401, "Authentication required")


def test_routes_reject_a_request_without_a_token():
    response = TestClient(app).get("/bills/dashboard")

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_rejected_token_is_401_and_logs_the_reason_not_the_token(caplog):
    error = AuthApiError("Invalid API key", 401, None)

    with caplog.at_level(logging.WARNING, logger="backend.auth"):
        result = failure(auth=auth_client(error=error))

    assert result == (401, "Invalid or expired access token")
    assert "Invalid API key" in caplog.text
    assert "secret-token" not in caplog.text


def test_token_without_a_user_is_401():
    assert failure(auth=auth_client(user=None)) == (
        401,
        "Invalid or expired access token",
    )


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("connection refused"),
        AuthRetryableError("Auth unavailable", 503),
        # Auth's own failures arrive as AuthApiError too; they say nothing
        # about the token, so they must not look like "signed out".
        AuthApiError("Database error querying schema", 500, None),
        AuthApiError("Request rate limit reached", 429, None),
        RuntimeError("unexpected"),
    ],
    ids=["connect-error", "retryable-error", "auth-500", "auth-429", "other-error"],
)
def test_unreachable_supabase_auth_is_503_not_500(error):
    assert failure(auth=auth_client(error=error)) == (
        503,
        "Unable to verify account.",
    )


def test_account_lookup_failure_is_503_not_500():
    admin = admin_client(error=RuntimeError("connection refused"))

    assert failure(admin=admin) == (503, "Unable to verify account.")


def test_user_without_an_app_users_row_is_403_and_no_row_is_created():
    admin = admin_client(no_match=True)

    assert failure(admin=admin) == (403, "Account not found. Contact an admin.")
    admin.table.return_value.insert.assert_not_called()
    admin.table.return_value.upsert.assert_not_called()


# require_active(analyst, admin), for each role and status

ALLOWED = (UserRole.analyst, UserRole.admin)
WAITING = (403, "Your account is waiting for approval.")
WRONG_ROLE = (403, "Your role can't do this.")


REQUIRE_ACTIVE_CASES = [
    (UserRole.analyst, "active", None),
    (UserRole.admin, "active", None),
    (UserRole.approver, "active", WRONG_ROLE),
    (UserRole.analyst, "inactive", WAITING),
    (UserRole.admin, "inactive", WAITING),
    (UserRole.approver, "inactive", WAITING),
]


def test_require_active_cases_cover_every_role_and_status():
    cases = {(role, status) for role, status, _ in REQUIRE_ACTIVE_CASES}

    assert cases == set(product(UserRole, ("active", "inactive")))


@pytest.mark.parametrize(("role", "status", "expected"), REQUIRE_ACTIVE_CASES)
def test_require_active(role, status, expected):
    user = make_user(role=role, status=status)
    dependency = require_active(*ALLOWED)

    if expected is None:
        assert dependency(user) is user
    else:
        with pytest.raises(HTTPException) as exc:
            dependency(user)
        assert (exc.value.status_code, exc.value.detail) == expected

"""Real signups and real tokens against the LOCAL Supabase stack.

Opt in with RUN_LOCAL_SUPABASE_TESTS=1, with the local values from
`npx supabase status -o env` (run in backend/) exported as SUPABASE_URL
(API_URL), SUPABASE_PUBLISHABLE_KEY (PUBLISHABLE_KEY) and SUPABASE_SECRET_KEY
(SECRET_KEY). backend/.env may hold live values, so these tests fail unless
SUPABASE_URL points at 127.0.0.1 or localhost. Users they create are deleted.
CI runs them on every PR and on main (the backend-real-login job in
.github/workflows/ci.yml) and fails the job if they skip.
"""

import os
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.settings import Settings, get_settings
from backend.supabase_client import get_admin_supabase
from supabase import create_client

pytestmark = [
    pytest.mark.local_supabase,
    pytest.mark.skipif(
        os.environ.get("RUN_LOCAL_SUPABASE_TESTS") != "1",
        reason="set RUN_LOCAL_SUPABASE_TESTS=1 to run against the local stack",
    ),
]

LOCAL_HOSTS = {"127.0.0.1", "localhost"}


# autouse: no test in this file can reach Supabase before the host check.
@pytest.fixture(autouse=True)
def local() -> Settings:
    settings = get_settings()
    host = urlsplit(settings.supabase_url).hostname
    if host not in LOCAL_HOSTS:
        pytest.fail(
            f"SUPABASE_URL host is {host!r}: these tests create and delete users, "
            "so they run only against the local stack (127.0.0.1 or localhost)",
            pytrace=False,
        )
    return settings


@pytest.fixture
def sign_up(local: Settings):
    """Sign up a real user, set their role and status, return (id, token)."""
    admin = get_admin_supabase()
    created: list[str] = []

    def make(role: str | None = None, status: str | None = None) -> tuple[str, str]:
        # A fresh client per user: signing in stores the session on the client.
        client = create_client(local.supabase_url, local.supabase_publishable_key)
        response = client.auth.sign_up(
            {"email": f"dc39a-{uuid4().hex[:12]}@example.com", "password": uuid4().hex}
        )
        assert response.user is not None and response.session is not None
        user_id = response.user.id
        created.append(user_id)

        changes = {k: v for k, v in {"role": role, "status": status}.items() if v}
        if changes:
            admin.table("app_users").update(changes).eq("user_id", user_id).execute()
        return user_id, response.session.access_token

    yield make

    for user_id in created:
        admin.auth.admin.delete_user(user_id)


@pytest.fixture
def api(local: Settings):
    with TestClient(app) as client:  # runs the startup settings check
        yield client


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_new_signup_is_inactive_and_waits_for_approval(sign_up, api):
    user_id, token = sign_up()

    me = api.get("/me", headers=bearer(token))
    assert me.status_code == 200
    assert me.json()["id"] == user_id
    assert (me.json()["role"], me.json()["status"]) == ("analyst", "inactive")

    dashboard = api.get("/bills/dashboard", headers=bearer(token))
    assert dashboard.status_code == 403
    assert dashboard.json()["detail"] == "Your account is waiting for approval."


def test_active_analyst_reaches_the_dashboard(sign_up, api):
    _, token = sign_up(status="active")

    assert api.get("/me", headers=bearer(token)).json()["status"] == "active"
    dashboard = api.get("/bills/dashboard", headers=bearer(token))
    assert dashboard.status_code == 200
    assert dashboard.json() == []


def test_active_approver_views_the_dashboard_but_cannot_create_drafts(sign_up, api):
    _, token = sign_up(role="approver", status="active")

    assert api.get("/bills/dashboard", headers=bearer(token)).status_code == 200
    draft = api.post("/bills/drafts", headers=bearer(token), json={"amount": "1.00"})
    assert draft.status_code == 403
    assert draft.json()["detail"] == "Your role can't do this."


def test_a_token_supabase_rejects_is_401(api, local):
    response = api.get("/me", headers=bearer("not-a-real-token"))

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired access token"


def test_a_deleted_profile_is_403_and_stays_deleted(sign_up, api):
    user_id, token = sign_up(status="active")
    app_users = get_admin_supabase().table("app_users")
    app_users.delete().eq("user_id", user_id).execute()

    response = api.get("/me", headers=bearer(token))

    assert response.status_code == 403
    assert response.json()["detail"] == "Account not found. Contact an admin."
    rows = app_users.select("user_id").eq("user_id", user_id).execute().data
    assert rows == []

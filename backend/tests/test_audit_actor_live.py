"""The actor header reaches the audit trigger, through real PostgREST.

`test_audit_actor.py` proves the backend sends `X-Audit-Actor-Id`; the pgTAP
tests prove the trigger reads it when it is there. This file proves the join
neither can: a signed-in user calls a real route, the admin Supabase client
writes through PostgREST, and the row in `audit.record_changes` names that user.

Opt in with RUN_LOCAL_SUPABASE_TESTS=1, like `test_auth_local_supabase.py`, with
the values from `supabase status -o env` (run in backend/) exported as
SUPABASE_URL (API_URL), SUPABASE_PUBLISHABLE_KEY (PUBLISHABLE_KEY) and
SUPABASE_SECRET_KEY (SECRET_KEY), plus DATABASE_URL (DB_URL) to read the log:
the `audit` schema is not exposed through the API, by design. These tests fail
unless SUPABASE_URL points at 127.0.0.1 or localhost. Users and bills they
create are deleted; the log rows they cause stay, because the log is
append-only.
"""

import contextvars
import os
from collections.abc import Callable, Iterator
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from backend.app import app
from backend.settings import Settings, get_settings
from backend.supabase_client import get_admin_supabase
from supabase import create_client

pytestmark = [
    pytest.mark.local_supabase,
    pytest.mark.skipif(
        os.environ.get("RUN_LOCAL_SUPABASE_TESTS") != "1"
        or not os.environ.get("DATABASE_URL"),
        reason="set RUN_LOCAL_SUPABASE_TESTS=1 and DATABASE_URL to run against "
        "the local stack",
    ),
]

LOCAL_HOSTS = {"127.0.0.1", "localhost"}


# autouse: nothing in this file can reach Supabase before the host check.
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
def log() -> Iterator[Callable[[str], list[dict[str, Any]]]]:
    """Read `audit.record_changes` of one bill, oldest first."""
    with psycopg.connect(
        os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row
    ) as connection:

        def rows_of(bill_id: str) -> list[dict[str, Any]]:
            return connection.execute(
                "select op, actor_id::text as actor_id, actor_role "
                "from audit.record_changes "
                "where table_name = 'bills' and bill_id = %s order by id",
                (bill_id,),
            ).fetchall()

        yield rows_of


@pytest.fixture
def sign_up(local: Settings) -> Iterator[Callable[[], tuple[str, str]]]:
    """Sign up an active analyst, return (id, token). Their bills and the user
    are deleted afterwards (`bills.submitted_by` does not cascade)."""
    admin = get_admin_supabase()
    created: list[str] = []

    def make() -> tuple[str, str]:
        # A fresh client per user: signing in stores the session on the client.
        client = create_client(local.supabase_url, local.supabase_publishable_key)
        response = client.auth.sign_up(
            {"email": f"audit-{uuid4().hex[:12]}@example.com", "password": uuid4().hex}
        )
        assert response.user is not None and response.session is not None
        created.append(response.user.id)
        admin.table("app_users").update({"status": "active"}).eq(
            "user_id", response.user.id
        ).execute()
        return response.user.id, response.session.access_token

    yield make

    if created:
        admin.table("bills").delete().in_("submitted_by", created).execute()
    for user_id in created:
        admin.auth.admin.delete_user(user_id)


@pytest.fixture
def api(local: Settings) -> Iterator[TestClient]:
    with TestClient(app) as client:  # runs the startup settings check
        yield client


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_a_route_write_is_logged_with_the_signed_in_user(sign_up, api, log):
    user_id, token = sign_up()

    draft = api.post("/bills/drafts", headers=bearer(token), json={"amount": "1.00"})

    assert draft.status_code == 201, draft.text
    # The write went through the service role, yet the log names the person.
    assert log(draft.json()["bill_id"]) == [
        {"op": "INSERT", "actor_id": user_id, "actor_role": "service_role"}
    ]


def test_each_request_names_its_own_user(sign_up, api, log):
    first_id, first = sign_up()
    second_id, second = sign_up()

    drafts = [
        (
            first_id,
            api.post("/bills/drafts", headers=bearer(first), json={"amount": "1.00"}),
        ),
        (
            second_id,
            api.post("/bills/drafts", headers=bearer(second), json={"amount": "1.00"}),
        ),
        (
            first_id,
            api.post("/bills/drafts", headers=bearer(first), json={"amount": "1.00"}),
        ),
    ]

    for user_id, draft in drafts:
        assert draft.status_code == 201, draft.text
        assert [r["actor_id"] for r in log(draft.json()["bill_id"])] == [user_id]


def test_a_write_outside_a_request_has_no_actor(sign_up, log):
    # A bare call to the admin client sets no actor: the log must say "nobody",
    # not the user of an earlier request.
    user_id, _ = sign_up()

    def write() -> str:
        row = {"submitted_by": user_id, "status": "draft"}
        created = get_admin_supabase().table("bills").insert(row).execute()
        return created.data[0]["bill_id"]

    # An empty context: nothing another test set can leak in.
    bill_id = contextvars.Context().run(write)

    assert log(bill_id) == [
        {"op": "INSERT", "actor_id": None, "actor_role": "service_role"}
    ]

"""API writes tell the database who made them (backend/audit_actor.py).

The audit triggers read the actor from the `X-Audit-Actor-Id` header, because
the routes write with the service-role client and the database never sees the
user. These tests run the real routes and the real admin Supabase client, with
only the network replaced, and look at the requests it would send.
"""

import json
from collections.abc import Callable
from contextvars import copy_context
from uuid import UUID, uuid4

import httpx
import pytest
from current_users import make_user
from fastapi.testclient import TestClient

from backend.app import app
from backend.audit_actor import ACTOR_HEADER, attach_actor_header, set_actor
from backend.auth import get_current_user
from backend.schemas.user import UserRole
from backend.supabase_client import get_admin_supabase

BILL_ID = str(uuid4())
VENDOR_ID = str(uuid4())


def _bill_row(submitted_by: str) -> dict:
    return {
        "bill_id": BILL_ID,
        "status": "draft",
        "document_path": None,
        "created_at": "2026-11-10T00:00:00+00:00",
        "submitter": {"user_id": submitted_by, "full_name": "Test"},
    }


class Network:
    """Stands in for PostgREST: records each request and answers it."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("/vendors"):
            return httpx.Response(
                201,
                json=[
                    {
                        "vendor_id": VENDOR_ID,
                        "vendor_name": "Acme",
                        "created_at": "2026-11-10T00:00:00+00:00",
                    }
                ],
            )
        submitted_by = json.loads(request.content)["submitted_by"]
        return httpx.Response(201, json=_bill_row(submitted_by))

    def actors(self) -> list[str | None]:
        return [request.headers.get(ACTOR_HEADER) for request in self.requests]


@pytest.fixture
def network(monkeypatch: pytest.MonkeyPatch) -> Network:
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    net = Network()
    # The real admin client, its requests answered here instead of by Supabase.
    get_admin_supabase().postgrest.session._transport = httpx.MockTransport(net.handle)
    return net


def _sign_in_as(role: UserRole) -> UUID:
    user = make_user(role=role)
    app.dependency_overrides[get_current_user] = lambda: user
    return user.id


def test_a_bill_written_through_the_api_carries_the_signed_in_user(network):
    user_id = _sign_in_as(UserRole.analyst)

    response = TestClient(app).post("/bills/drafts", json={"amount": "10.00"})

    assert response.status_code == 201, response.text
    assert network.actors() == [str(user_id)]


def test_a_vendor_written_through_the_api_carries_the_signed_in_admin(network):
    user_id = _sign_in_as(UserRole.admin)

    response = TestClient(app).post("/vendors", json={"name": "Acme"})

    assert response.status_code == 201, response.text
    assert network.actors() == [str(user_id)]


def test_each_request_carries_its_own_user_never_the_previous_ones(network):
    client = TestClient(app)
    first = _sign_in_as(UserRole.analyst)
    client.post("/bills/drafts", json={"amount": "1.00"})
    second = _sign_in_as(UserRole.admin)
    client.post("/bills/drafts", json={"amount": "2.00"})

    assert network.actors() == [str(first), str(second)]
    assert first != second


def test_a_request_with_no_signed_in_user_carries_no_actor(network):
    # Outside a request nothing has named an actor, so nothing is sent.
    get_admin_supabase().table("vendors").insert({"vendor_name": "x"}).execute()

    assert network.actors() == [None]


def test_a_refused_caller_never_reaches_the_database(network):
    app.dependency_overrides[get_current_user] = lambda: make_user(
        role=UserRole.approver
    )

    response = TestClient(app).post("/bills/drafts", json={"amount": "10.00"})

    assert response.status_code == 403
    assert network.requests == []


def _session_with(
    handler: Callable[[httpx.Request], httpx.Response],
) -> httpx.Client:
    session = httpx.Client(transport=httpx.MockTransport(handler))
    attach_actor_header(session)
    return session


def test_the_header_is_the_actor_and_replaces_any_other_value():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    session = _session_with(handler)
    actor = uuid4()

    def request_as_actor() -> None:
        set_actor(actor)
        session.get("http://db/x", headers={ACTOR_HEADER: str(uuid4())})

    copy_context().run(request_as_actor)  # a context of its own, as in a request
    session.get("http://db/x", headers={ACTOR_HEADER: str(uuid4())})

    assert seen[0].headers[ACTOR_HEADER] == str(actor)
    assert ACTOR_HEADER not in seen[1].headers


def test_an_actor_set_in_one_context_is_not_visible_in_another():
    seen: list[httpx.Request] = []
    session = _session_with(lambda request: seen.append(request) or httpx.Response(200))

    copy_context().run(set_actor, uuid4())
    copy_context().run(session.get, "http://db/x")

    assert ACTOR_HEADER not in seen[0].headers

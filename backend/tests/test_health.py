"""GET /health runs a real query with the publishable client and says which
commit is deployed, without leaking error details."""

import logging
from collections.abc import Callable
from typing import Any

import pytest
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend import supabase_client
from backend.app import app

client = TestClient(app)

PUBLISHABLE_KEY = "sb_publishable_test"
SECRET_KEY = "sb_secret_test"
LEAKY_ERROR = "connection to https://example.supabase.co refused, key sb_secret_test"


class _FailingQuery:
    def __getattr__(self, _name: str) -> Callable[..., Any]:
        def fail(*_args: Any, **_kwargs: Any) -> Any:
            raise RuntimeError(LEAKY_ERROR)

        return fail


class _FailingSupabase:
    def table(self, _name: str) -> _FailingQuery:
        return _FailingQuery()


@pytest.fixture
def supabase_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", SECRET_KEY)
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)


def use_publishable_client(monkeypatch: pytest.MonkeyPatch, fake: Any) -> list[str]:
    """The real getters run; only client creation is replaced. Returns the keys
    clients were created with. The secret-key (admin) client cannot be created,
    so a route that asks for it fails."""
    keys: list[str] = []

    def create_client(_url: str, key: str, options: Any = None) -> Any:
        keys.append(key)
        if key != PUBLISHABLE_KEY:
            raise AssertionError("/health must never use the admin client")
        return fake

    monkeypatch.setattr(supabase_client, "create_client", create_client)
    return keys


def test_health_ok_when_the_query_succeeds(supabase_env, monkeypatch):
    use_publishable_client(monkeypatch, FakeSupabase())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "commit": None}


def test_health_runs_a_query(supabase_env, monkeypatch):
    queried: list[str] = []
    fake = FakeSupabase()
    real_table = fake.table

    def table(name: str):
        queried.append(name)
        return real_table(name)

    monkeypatch.setattr(fake, "table", table)
    use_publishable_client(monkeypatch, fake)

    assert client.get("/health").status_code == 200
    assert queried == ["bills"]


def test_health_503_without_error_details(supabase_env, monkeypatch, caplog):
    use_publishable_client(monkeypatch, _FailingSupabase())

    with caplog.at_level(logging.ERROR, logger="backend.api.health"):
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "error",
        "database": "unreachable",
        "commit": None,
    }
    for secret in (LEAKY_ERROR, "example.supabase.co", SECRET_KEY, PUBLISHABLE_KEY):
        assert secret not in response.text
    # The cause stays in the server log, with the exception attached.
    [record] = caplog.records
    assert record.exc_info is not None
    assert LEAKY_ERROR in str(record.exc_info[1])


def test_health_503_when_settings_are_missing(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["database"] == "unreachable"


@pytest.mark.parametrize("fake", [FakeSupabase, _FailingSupabase])
def test_health_reports_the_render_commit(supabase_env, monkeypatch, fake):
    use_publishable_client(monkeypatch, fake())
    monkeypatch.setenv("RENDER_GIT_COMMIT", "0ebac2c1234567890abcdef")

    assert client.get("/health").json()["commit"] == "0ebac2c1234567890abcdef"


@pytest.mark.parametrize("value", [None, ""])
def test_health_commit_is_null_without_render(supabase_env, monkeypatch, value):
    use_publishable_client(monkeypatch, FakeSupabase())
    if value is not None:
        monkeypatch.setenv("RENDER_GIT_COMMIT", value)

    assert client.get("/health").json()["commit"] is None


def test_health_uses_only_the_publishable_client(supabase_env, monkeypatch):
    # /health is open, so the admin client (which bypasses RLS) must never run.
    keys = use_publishable_client(monkeypatch, FakeSupabase())

    def no_admin_client() -> None:
        raise AssertionError("/health must never use the admin client")

    monkeypatch.setattr(supabase_client, "get_admin_supabase", no_admin_client)

    assert client.get("/health").status_code == 200
    assert keys == [PUBLISHABLE_KEY]


def test_test_db_is_gone():
    assert client.get("/test-db").status_code == 404

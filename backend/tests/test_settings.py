"""The backend refuses to start with missing or malformed Supabase settings."""

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.settings import Settings, get_settings

VALID = {
    "SUPABASE_URL": "https://abc.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "publishable",
    "SUPABASE_SECRET_KEY": "secret",
}


@pytest.fixture
def env(monkeypatch):
    """Set the backend settings to `VALID`, overridden by `changes`."""

    def apply(**changes: str | None) -> None:
        for name, value in {**VALID, **changes}.items():
            if value is None:
                monkeypatch.delenv(name, raising=False)
            else:
                monkeypatch.setenv(name, value)

    return apply


def test_valid_settings_are_read(env):
    env()

    assert get_settings() == Settings(
        supabase_url="https://abc.supabase.co",
        supabase_publishable_key="publishable",
        supabase_secret_key="secret",
    )


@pytest.mark.parametrize("name", list(VALID))
def test_a_missing_setting_names_itself(env, name):
    env(**{name: None})

    with pytest.raises(RuntimeError, match=f"Missing environment variable {name};"):
        get_settings()


@pytest.mark.parametrize("name", list(VALID))
def test_a_blank_setting_is_missing(env, name):
    env(**{name: "   "})

    with pytest.raises(RuntimeError, match=f"Missing environment variable {name};"):
        get_settings()


@pytest.mark.parametrize(
    "url",
    [
        "https://abc.supabase.co/rest/v1",
        "https://abc.supabase.co/rest/v1/",
        "https://abc.supabase.co/auth/v1",
        "https://abc.supabase.co//",
        "https://abc.supabase.co?x=1",
        "https://abc.supabase.co#top",
    ],
)
def test_a_url_with_a_path_is_rejected(env, url):
    env(SUPABASE_URL=url)

    with pytest.raises(RuntimeError, match="project URL with no path") as exc:
        get_settings()
    assert "not the REST URL" in str(exc.value)


@pytest.mark.parametrize(
    "url",
    [
        "abc.supabase.co",
        "localhost:54321",
        "ftp://abc.supabase.co",
        "https://",
        "http://127.0.0.1:notaport",
        "https://user:pass@abc.supabase.co",
    ],
)
def test_a_url_that_is_not_http_host_port_is_rejected(env, url):
    env(SUPABASE_URL=url)

    with pytest.raises(RuntimeError, match="SUPABASE_URL must look like"):
        get_settings()


def test_a_bad_url_is_not_echoed_into_the_log(env):
    # A key pasted into the wrong variable must not reach the deploy log.
    env(SUPABASE_URL="sb_secret_abc123")

    with pytest.raises(RuntimeError) as exc:
        get_settings()
    assert "sb_secret_abc123" not in str(exc.value)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://abc.supabase.co/", "https://abc.supabase.co"),
        ("http://127.0.0.1:54321/", "http://127.0.0.1:54321"),
        ("http://localhost:54321", "http://localhost:54321"),
    ],
)
def test_one_trailing_slash_is_trimmed(env, url, expected):
    env(SUPABASE_URL=url)

    assert get_settings().supabase_url == expected


def test_settings_are_read_once(env, monkeypatch):
    env()
    first = get_settings()
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "changed")

    assert get_settings() is first


def test_the_app_does_not_start_with_a_bad_setting(env):
    env(SUPABASE_URL="https://abc.supabase.co/rest/v1")

    with pytest.raises(RuntimeError, match="not the REST URL"):
        with TestClient(app):
            pass


def test_the_app_starts_with_valid_settings(env):
    env()

    with TestClient(app) as client:
        assert client.get("/").status_code == 200

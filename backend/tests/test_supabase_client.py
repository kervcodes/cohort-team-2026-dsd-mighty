"""Backend settings come only from backend names (see backend/.env.example)."""

import pytest

from backend import supabase_client

BACKEND_NAMES = ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY")


@pytest.fixture
def frontend_names_only(monkeypatch):
    """Only the frontend's NEXT_* names are set, as in the repo-root .env."""
    for name in BACKEND_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable")
    monkeypatch.setenv("NEXT_SUPABASE_SECRET_KEY", "secret")


def test_admin_client_never_reads_a_next_named_secret(frontend_names_only):
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        supabase_client.get_admin_supabase()


def test_secret_key_has_no_fallback(frontend_names_only, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable")

    with pytest.raises(RuntimeError, match="SUPABASE_SECRET_KEY"):
        supabase_client.get_admin_supabase()


def test_publishable_key_has_no_fallback(frontend_names_only, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "secret")

    with pytest.raises(RuntimeError, match="SUPABASE_PUBLISHABLE_KEY"):
        supabase_client.get_supabase()


def test_each_client_is_created_once_per_process(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")

    assert supabase_client.get_supabase() is supabase_client.get_supabase()
    assert supabase_client.get_admin_supabase() is supabase_client.get_admin_supabase()
    assert supabase_client.get_supabase() is not supabase_client.get_admin_supabase()

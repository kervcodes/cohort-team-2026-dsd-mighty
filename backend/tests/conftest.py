"""Keep model API keys out of the test run: CI never calls a model.

The fixture is autouse at the top of `tests/`, so it covers every backend test.

`backend/src/backend/settings.py` calls `load_dotenv()` at import, which
copies `backend/.env` (where a developer keeps real keys) into `os.environ`. The
fixture below removes the keys before every test and wraps `dotenv.load_dotenv`
so a late `.env` load cannot put them back during a test.
"""

import os
from collections.abc import Iterator

import dotenv
import pytest

from backend.app import app
from backend.settings import get_settings
from backend.supabase_client import get_admin_supabase, get_supabase

MODEL_KEY_VARS = ("ANTHROPIC_API_KEY", "GEMINI_API_KEY")


@pytest.fixture(autouse=True)
def no_model_api_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in MODEL_KEY_VARS:
        monkeypatch.delenv(var, raising=False)

    real_load_dotenv = dotenv.load_dotenv

    def guarded_load_dotenv(*args: object, **kwargs: object) -> bool:
        loaded = real_load_dotenv(*args, **kwargs)  # type: ignore[arg-type]
        for var in MODEL_KEY_VARS:
            os.environ.pop(var, None)
        return loaded

    monkeypatch.setattr(dotenv, "load_dotenv", guarded_load_dotenv)


@pytest.fixture(autouse=True)
def no_leftover_overrides() -> Iterator[None]:
    """A test's `app.dependency_overrides` (a signed-in user) never reaches the
    next test, which may check that unauthenticated requests are refused."""
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def fresh_settings_and_clients() -> Iterator[None]:
    """Settings and Supabase clients are cached per process; tests that change
    the environment must not see another test's cached values."""
    caches = (get_settings, get_supabase, get_admin_supabase)
    for cached in caches:
        cached.cache_clear()
    yield
    for cached in caches:
        cached.cache_clear()

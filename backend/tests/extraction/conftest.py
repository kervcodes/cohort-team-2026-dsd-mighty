"""Keep model API keys out of the test run: CI never calls a model.

`backend/src/backend/supabase_client.py` calls `load_dotenv()` at import, which
copies `backend/.env` (where a developer keeps real keys) into `os.environ`. The
fixture below removes the keys before every test and wraps `dotenv.load_dotenv`
so a late `.env` load cannot put them back during a test.
"""

import os

import dotenv
import pytest

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

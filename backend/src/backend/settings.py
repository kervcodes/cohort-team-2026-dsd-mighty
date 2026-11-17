"""Backend settings, read once and checked at startup (see backend/.env.example).

Backend settings use backend-only names. There are deliberately no fallbacks to
the frontend's `NEXT_*` names: a secret under a `NEXT_` name looks like frontend
config, and one slip to `NEXT_PUBLIC_` would ship it to the browser.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str  # http(s)://host[:port], no path
    supabase_publishable_key: str
    supabase_secret_key: str


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing environment variable {name}; see backend/.env.example"
        )
    return value


def _project_url(name: str) -> str:
    """The Supabase project URL, with one trailing `/` trimmed.

    The value is never echoed in the error: a key pasted into the wrong
    variable would end up in the deploy log.
    """
    url = _env(name).removesuffix("/")
    parts = urlsplit(url)
    try:
        port_ok = parts.port is None or parts.port > 0
    except ValueError:  # a non-numeric or out-of-range port
        port_ok = False
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or not port_ok
        or parts.username is not None
    ):
        raise RuntimeError(
            f"{name} must look like https://<ref>.supabase.co or "
            "http://127.0.0.1:54321; see backend/.env.example"
        )
    if parts.path or parts.query or parts.fragment:
        raise RuntimeError(
            f"{name} must be the project URL with no path, like "
            "https://<ref>.supabase.co, not the REST URL ending in /rest/v1"
        )
    return url


@lru_cache
def get_settings() -> Settings:
    return Settings(
        supabase_url=_project_url("SUPABASE_URL"),
        supabase_publishable_key=_env("SUPABASE_PUBLISHABLE_KEY"),
        supabase_secret_key=_env("SUPABASE_SECRET_KEY"),
    )

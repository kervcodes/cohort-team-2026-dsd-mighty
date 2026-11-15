"""The Claude client and model settings for the payment agent.

The key is read from `ANTHROPIC_API_KEY` (after loading `backend/.env`) and
never logged; tests remove it (tests/conftest.py), so a test that forgets to
pass a fake model client fails here instead of calling Claude.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import anthropic
import dotenv

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"  # backend/.env

DEFAULT_MODEL = "claude-opus-5-5"
MODEL_SETTING = "PAYMENT_AGENT_MODEL"

TIMEOUT_SECONDS = 60
MAX_RETRIES = 2
MAX_OUTPUT_TOKENS = 16_000

# Server-side refusal fallback: if the model declines for policy reasons, the
# API re-runs the request on the model's default fallback instead of ending
# the run. The tools' checks do not depend on which model calls them.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class MissingApiKeyError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("ANTHROPIC_API_KEY is not set; add it to backend/.env")


class ModelClient(Protocol):
    """What the agent uses of `anthropic.Anthropic`: `beta.messages.create`.
    Tests pass a scripted stand-in."""

    @property
    def beta(self) -> Any: ...


@dataclass(frozen=True)
class AgentConfig:
    model: str = DEFAULT_MODEL
    max_model_turns: int = 12  # the happy path takes 5
    time_limit_seconds: float = 300.0
    portal_timeout_ms: int = 15_000  # per browser action
    effort: str = "medium"


def agent_config() -> AgentConfig:
    dotenv.load_dotenv(ENV_FILE)  # does not override variables already set
    model = os.environ.get(MODEL_SETTING, "").strip() or DEFAULT_MODEL
    return AgentConfig(model=model)


def create_model_client() -> anthropic.Anthropic:
    dotenv.load_dotenv(ENV_FILE)
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise MissingApiKeyError
    return anthropic.Anthropic(
        api_key=key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
    )

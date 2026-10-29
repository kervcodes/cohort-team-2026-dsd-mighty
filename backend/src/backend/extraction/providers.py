"""Model calls for bill extraction (DC-52): Claude and Gemini, same output.

Every provider has the `Provider` signature: it sends the file as-is with the
system prompt, forces the response into the `BillExtraction` JSON schema and
returns the parsed extraction with token usage. It raises:

- `MissingApiKeyError` when its API key is not set (a configuration error);
- `ProviderError` for a model error, timeout, refusal or truncated output;
- `InvalidOutputError` (a `ProviderError`) when the output does not fit the
  schema.

`extract.py` turns the last two into status `failed`. Keys are read from the
environment, after loading `backend/.env`, and are never logged.

This module must not import Supabase (see ENFORCEMENT.md).
"""

import base64
import os
from dataclasses import dataclass
from decimal import Decimal
from functools import cache
from pathlib import Path
from typing import Any, Protocol

import anthropic
import dotenv
import httpx
import httpx2
import pydantic
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

from backend.extraction.prompt import SYSTEM_PROMPT, USER_PROMPT
from backend.extraction.schema import BillExtraction

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"  # backend/.env

TIMEOUT_SECONDS = 60
MAX_RETRIES = 2
MAX_OUTPUT_TOKENS = 8192  # a 5-page bill with many line items stays well under

CLAUDE_HAIKU = "claude-haiku-5-5"
CLAUDE_SONNET = "claude-sonnet-5-5"
CLAUDE_OPUS = "claude-opus-5-5"
GEMINI_FLASH = "gemini-3.8-flash"
GEMINI_FLASH_PREVIOUS = "gemini-3.6-flash"  # fallback while 3.8 returns 503s

# Extended thinking is off: extraction is simple and we want speed. Set this to
# True to let every model think (adaptive thinking on Claude, Gemini's default
# level), then compare on the eval.
THINKING = False


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int  # billed output, including any thinking tokens


@dataclass(frozen=True)
class ProviderOutput:
    extraction: BillExtraction
    usage: Usage


class Provider(Protocol):
    def __call__(
        self, data: bytes, media_type: str, *, model: str
    ) -> ProviderOutput: ...


class MissingApiKeyError(RuntimeError):
    """The model's API key is not set. Configuration error: never a status."""

    def __init__(self, var: str) -> None:
        super().__init__(f"{var} is not set; add it to backend/.env")
        self.var = var


class ProviderError(Exception):
    """The call did not produce an extraction. `usage` is set when tokens were
    billed anyway (for example output that did not fit the schema)."""

    def __init__(self, reason: str, usage: Usage | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.usage = usage


class InvalidOutputError(ProviderError):
    """The model answered, but the answer does not fit `BillExtraction`."""


# Prices per million tokens (input, output) in USD, checked 2026-10-29.
# Claude Haiku 5.5 is $0.10 / $0.50 for prompts up to 100K tokens (a 5-page
# bill is far below). Gemini 3.8 and 3.6 Flash are at their intro price until
# 2026-12-31, then $1.50 / $7.50.
PRICES_PER_MILLION: dict[str, tuple[Decimal, Decimal]] = {
    CLAUDE_HAIKU: (Decimal("0.10"), Decimal("0.50")),
    CLAUDE_SONNET: (Decimal("2"), Decimal("10")),
    CLAUDE_OPUS: (Decimal("4"), Decimal("20")),
    GEMINI_FLASH: (Decimal("0.75"), Decimal("3.75")),
    GEMINI_FLASH_PREVIOUS: (Decimal("0.75"), Decimal("3.75")),
}


def cost_usd(model: str, usage: Usage) -> float:
    """What the call cost, rounded to a millionth of a dollar."""
    input_price, output_price = PRICES_PER_MILLION[model]
    total = (
        usage.input_tokens * input_price + usage.output_tokens * output_price
    ) / Decimal(1_000_000)
    return float(total.quantize(Decimal("0.000001")))


def _api_key(var: str) -> str:
    dotenv.load_dotenv(ENV_FILE)  # does not override variables already set
    key = os.environ.get(var, "").strip()
    if not key:
        raise MissingApiKeyError(var)
    return key


def _reason(prefix: str, error: Exception) -> str:
    """A short failure reason. API error messages do not echo the document."""
    return f"{prefix}: {str(error)[:200]}"


# Claude


def claude_thinking_options(model: str, thinking: bool) -> dict[str, Any]:
    """Request options that turn thinking on or off for a Claude model.

    Each model spells "off" differently (claude-api skill, Thinking & Effort):
    Haiku 5.5 accepts `disabled`, Sonnet 5.5 only `between_tools`, and Opus 5.5
    cannot turn thinking off, so it runs adaptive at `low` effort.
    """
    if thinking:
        return {"thinking": {"type": "adaptive"}}
    if model == CLAUDE_HAIKU:
        return {"thinking": {"type": "disabled"}}
    if model == CLAUDE_SONNET:
        return {"thinking": {"type": "between_tools"}}
    return {"output_config": {"effort": "low"}}


@cache
def _claude_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(
        api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
    )


_CLAUDE_SCHEMA = anthropic.transform_schema(BillExtraction)


def _claude_file_block(data: bytes, media_type: str) -> dict[str, Any]:
    source = {
        "type": "base64",
        "media_type": media_type,
        "data": base64.standard_b64encode(data).decode("ascii"),
    }
    block_type = "document" if media_type == "application/pdf" else "image"
    return {"type": block_type, "source": source}


def call_claude(data: bytes, media_type: str, *, model: str) -> ProviderOutput:
    client = _claude_client(_api_key("ANTHROPIC_API_KEY"))
    options = claude_thinking_options(model, THINKING)
    output_config = {
        **options.pop("output_config", {}),
        "format": {"type": "json_schema", "schema": _CLAUDE_SCHEMA},
    }
    try:
        response = client.messages.create(
            model=model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        _claude_file_block(data, media_type),
                        {"type": "text", "text": USER_PROMPT},
                    ],
                }
            ],
            output_config=output_config,  # type: ignore[arg-type]
            **options,
        )
    except anthropic.APITimeoutError as error:
        raise ProviderError(_reason("model timeout", error)) from error
    except anthropic.APIConnectionError as error:
        raise ProviderError(_reason("model connection error", error)) from error
    except anthropic.APIStatusError as error:
        raise ProviderError(
            _reason(f"model error {error.status_code}", error)
        ) from error

    usage = Usage(response.usage.input_tokens, response.usage.output_tokens)
    if response.stop_reason != "end_turn":
        raise ProviderError(f"model stopped: {response.stop_reason}", usage)
    text = "".join(block.text for block in response.content if block.type == "text")
    return ProviderOutput(_parse(text, usage), usage)


# Gemini


def gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """A Pydantic JSON schema in the subset the Gemini docs list.

    Gemini structured output documents nullable types as a type array
    (`{"type": ["string", "null"]}`) and does not mention `$defs`, so this
    inlines every `$ref` and turns `anyOf: [X, {"type": "null"}]` into X with
    a nullable type. Everything else (enum, required, additionalProperties,
    descriptions) is kept, so the schema means the same as `BillExtraction`.
    """
    defs = schema.get("$defs", {})

    def convert(node: Any, seen: tuple[str, ...]) -> Any:
        if isinstance(node, list):
            return [convert(item, seen) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            name = node["$ref"].removeprefix("#/$defs/")
            if name in seen:
                raise ValueError(f"recursive schema at {name}")
            extra = {k: v for k, v in node.items() if k != "$ref"}
            return convert({**defs[name], **extra}, (*seen, name))
        node = {k: convert(v, seen) for k, v in node.items() if k != "$defs"}
        options = node.get("anyOf")
        if isinstance(options, list) and len(options) == 2:
            non_null = [o for o in options if o != {"type": "null"}]
            if len(non_null) == 1 and isinstance(non_null[0].get("type"), str):
                rest = {k: v for k, v in node.items() if k != "anyOf"}
                return {**non_null[0], **rest, "type": [non_null[0]["type"], "null"]}
        return node

    return convert(schema, ())


_GEMINI_SCHEMA = gemini_schema(BillExtraction.model_json_schema())


@cache
def _gemini_client(api_key: str) -> genai.Client:
    return genai.Client(
        api_key=api_key,
        http_options=genai_types.HttpOptions(
            timeout=TIMEOUT_SECONDS * 1000,  # milliseconds
            retry_options=genai_types.HttpRetryOptions(attempts=1 + MAX_RETRIES),
        ),
    )


def call_gemini(data: bytes, media_type: str, *, model: str) -> ProviderOutput:
    client = _gemini_client(_api_key("GEMINI_API_KEY"))
    # Gemini 3.x cannot turn thinking off: low is its lowest level.
    thinking = None if THINKING else genai_types.ThinkingConfig(thinking_level="low")
    try:
        response = client.models.generate_content(
            model=model,
            contents=[
                genai_types.Part.from_bytes(data=data, mime_type=media_type),
                USER_PROMPT,
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_json_schema=_GEMINI_SCHEMA,
                max_output_tokens=MAX_OUTPUT_TOKENS,
                thinking_config=thinking,
            ),
        )
    except (httpx.TimeoutException, httpx2.TimeoutException) as error:
        raise ProviderError(_reason("model timeout", error)) from error
    except (httpx.HTTPError, httpx2.HTTPError) as error:
        raise ProviderError(_reason("model connection error", error)) from error
    except genai_errors.APIError as error:
        raise ProviderError(_reason(f"model error {error.code}", error)) from error

    metadata = response.usage_metadata
    usage = Usage(
        input_tokens=(metadata and metadata.prompt_token_count) or 0,
        output_tokens=((metadata and metadata.candidates_token_count) or 0)
        + ((metadata and metadata.thoughts_token_count) or 0),
    )
    finish = response.candidates[0].finish_reason if response.candidates else None
    if finish != genai_types.FinishReason.STOP:
        name = finish.value if finish else "no candidate"
        raise ProviderError(f"model stopped: {name}", usage)
    return ProviderOutput(_parse(response.text or "", usage), usage)


def _parse(text: str, usage: Usage) -> BillExtraction:
    try:
        return BillExtraction.model_validate_json(text)
    except pydantic.ValidationError as error:
        raise InvalidOutputError(
            f"output did not fit the schema ({error.error_count()} errors)", usage
        ) from error


PROVIDERS: dict[str, Provider] = {
    CLAUDE_HAIKU: call_claude,
    CLAUDE_SONNET: call_claude,
    CLAUDE_OPUS: call_claude,
    GEMINI_FLASH: call_gemini,
    GEMINI_FLASH_PREVIOUS: call_gemini,
}

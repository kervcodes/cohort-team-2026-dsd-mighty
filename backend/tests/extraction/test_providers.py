"""Provider request shape, parsing and costs, with fake SDK clients (no network)."""

import base64
import json
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest
from bill_factory import clean_extraction
from google.genai import types as genai_types

from backend.extraction import providers
from backend.extraction.prompt import SYSTEM_PROMPT
from backend.extraction.providers import (
    CLAUDE_HAIKU,
    CLAUDE_OPUS,
    CLAUDE_SONNET,
    GEMINI_FLASH,
    PRICES_PER_MILLION,
    PROVIDERS,
    InvalidOutputError,
    ProviderError,
    Usage,
    call_claude,
    call_gemini,
    claude_thinking_options,
    cost_usd,
    gemini_schema,
)
from backend.extraction.schema import BillExtraction

VALID_JSON = clean_extraction().model_dump_json()


# Costs and registry


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        (CLAUDE_HAIKU, 0.60),
        (CLAUDE_SONNET, 12.0),
        (CLAUDE_OPUS, 24.0),
        (GEMINI_FLASH, 4.50),
    ],
)
def test_cost_of_a_million_tokens_each_way(model: str, expected: float):
    assert cost_usd(model, Usage(1_000_000, 1_000_000)) == pytest.approx(expected)


def test_cost_of_a_typical_bill_is_exact():
    # 4,321 x $0.10 + 1,234 x $0.50 per million = $0.0004321 + $0.000617
    assert cost_usd(CLAUDE_HAIKU, Usage(4321, 1234)) == 0.001049


def test_cost_of_an_unknown_model_raises():
    with pytest.raises(KeyError):
        cost_usd("gpt-x", Usage(1, 1))


def test_every_registered_model_has_a_price():
    assert PROVIDERS.keys() == PRICES_PER_MILLION.keys()


def test_thinking_is_off_by_default():
    assert providers.THINKING is False


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        (CLAUDE_HAIKU, {"thinking": {"type": "disabled"}}),
        (CLAUDE_SONNET, {"thinking": {"type": "between_tools"}}),
        (CLAUDE_OPUS, {"output_config": {"effort": "low"}}),  # cannot be disabled
    ],
)
def test_thinking_off_uses_each_models_accepted_setting(model: str, expected):
    assert claude_thinking_options(model, thinking=False) == expected


@pytest.mark.parametrize("model", [CLAUDE_HAIKU, CLAUDE_SONNET, CLAUDE_OPUS])
def test_thinking_on_is_adaptive(model: str):
    assert claude_thinking_options(model, thinking=True) == {
        "thinking": {"type": "adaptive"}
    }


# Gemini schema conversion


def walk(node: Any):
    yield node
    if isinstance(node, dict):
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


def test_gemini_schema_inlines_refs_and_makes_nulls_type_arrays():
    schema = gemini_schema(BillExtraction.model_json_schema())
    nodes = [n for n in walk(schema) if isinstance(n, dict)]
    assert not any("$ref" in n or "$defs" in n or "anyOf" in n for n in nodes)

    vendor = schema["properties"]["vendor_name"]
    assert vendor["required"] == ["value", "evidence", "confidence"]
    assert vendor["additionalProperties"] is False
    assert vendor["properties"]["value"]["type"] == ["string", "null"]
    assert "description" in vendor["properties"]["value"]
    assert vendor["properties"]["evidence"]["type"] == "string"
    assert vendor["properties"]["confidence"]["enum"] == ["high", "medium", "low"]
    assert schema["properties"]["document_type"]["enum"] == [
        "invoice",
        "not_an_invoice",
    ]
    line_item = schema["properties"]["line_items"]["items"]
    assert line_item["properties"]["amount"]["properties"]["value"]["type"] == [
        "string",
        "null",
    ]


def test_gemini_schema_keeps_every_field_and_requirement():
    original = BillExtraction.model_json_schema()
    schema = gemini_schema(original)
    assert schema["properties"].keys() == original["properties"].keys()
    assert schema["required"] == original["required"]
    assert schema["additionalProperties"] is False


def test_gemini_schema_leaves_other_any_of_alone():
    node = {"anyOf": [{"type": "string"}, {"type": "integer"}]}
    assert gemini_schema(node) == node


def test_gemini_schema_rejects_recursion():
    recursive = {
        "$defs": {
            "Node": {"type": "object", "properties": {"next": {"$ref": "#/$defs/Node"}}}
        },
        "$ref": "#/$defs/Node",
    }
    with pytest.raises(ValueError, match="recursive"):
        gemini_schema(recursive)


# Claude with a fake client


class FakeClaudeMessages:
    def __init__(self, response: Any = None, error: Exception | None = None):
        self.response = response
        self.error = error
        self.kwargs: dict[str, Any] = {}

    def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return self.response


def claude_response(text: str = VALID_JSON, stop_reason: str = "end_turn"):
    return SimpleNamespace(
        usage=SimpleNamespace(input_tokens=2500, output_tokens=900),
        stop_reason=stop_reason,
        content=[
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text=text),
        ],
    )


@pytest.fixture
def fake_claude(monkeypatch: pytest.MonkeyPatch):
    messages = FakeClaudeMessages(claude_response())
    monkeypatch.setattr(providers, "_api_key", lambda var: "test-key")
    monkeypatch.setattr(
        providers, "_claude_client", lambda key: SimpleNamespace(messages=messages)
    )
    return messages


def test_claude_sends_a_pdf_as_a_document_block(fake_claude: FakeClaudeMessages):
    output = call_claude(b"%PDF-bytes", "application/pdf", model=CLAUDE_HAIKU)
    assert output.extraction == clean_extraction()
    assert output.usage == Usage(2500, 900)

    kwargs = fake_claude.kwargs
    assert kwargs["model"] == CLAUDE_HAIKU
    assert kwargs["system"] == SYSTEM_PROMPT
    assert kwargs["thinking"] == {"type": "disabled"}
    assert kwargs["output_config"]["format"]["type"] == "json_schema"
    assert kwargs["output_config"]["format"]["schema"]["additionalProperties"] is False
    block = kwargs["messages"][0]["content"][0]
    assert block["type"] == "document"
    assert block["source"]["media_type"] == "application/pdf"
    assert base64.standard_b64decode(block["source"]["data"]) == b"%PDF-bytes"
    assert "temperature" not in kwargs


def test_claude_sends_an_image_as_an_image_block(fake_claude: FakeClaudeMessages):
    call_claude(b"png-bytes", "image/png", model=CLAUDE_HAIKU)
    block = fake_claude.kwargs["messages"][0]["content"][0]
    assert block["type"] == "image"
    assert block["source"]["media_type"] == "image/png"


def test_claude_opus_runs_at_low_effort_with_the_schema(fake_claude):
    call_claude(b"%PDF", "application/pdf", model=CLAUDE_OPUS)
    assert "thinking" not in fake_claude.kwargs
    assert fake_claude.kwargs["output_config"]["effort"] == "low"
    assert "format" in fake_claude.kwargs["output_config"]


def test_claude_output_that_does_not_fit_fails_with_usage(fake_claude):
    bad = json.loads(VALID_JSON)
    bad["amount_due"]["confidence"] = "certain"
    fake_claude.response = claude_response(json.dumps(bad))
    with pytest.raises(InvalidOutputError) as raised:
        call_claude(b"%PDF", "application/pdf", model=CLAUDE_HAIKU)
    assert raised.value.usage == Usage(2500, 900)
    assert "certain" not in raised.value.reason  # no extracted values


@pytest.mark.parametrize("stop_reason", ["max_tokens", "refusal"])
def test_claude_truncated_or_refused_output_fails(fake_claude, stop_reason: str):
    fake_claude.response = claude_response(VALID_JSON[:50], stop_reason)
    with pytest.raises(ProviderError, match=f"model stopped: {stop_reason}") as raised:
        call_claude(b"%PDF", "application/pdf", model=CLAUDE_HAIKU)
    assert not isinstance(raised.value, InvalidOutputError)
    assert raised.value.usage == Usage(2500, 900)


REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (anthropic.APITimeoutError(request=REQUEST), "model timeout"),
        (anthropic.APIConnectionError(request=REQUEST), "model connection error"),
        (
            anthropic.InternalServerError(
                "overloaded",
                response=httpx2.Response(529, request=REQUEST),
                body=None,
            ),
            "model error 529",
        ),
    ],
)
def test_claude_sdk_errors_become_provider_errors(fake_claude, error, reason: str):
    fake_claude.error = error
    with pytest.raises(ProviderError, match=reason):
        call_claude(b"%PDF", "application/pdf", model=CLAUDE_HAIKU)


# Gemini with a fake client


class FakeGeminiModels:
    def __init__(self, response: Any):
        self.response = response
        self.kwargs: dict[str, Any] = {}

    def generate_content(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        return self.response


def gemini_response(
    text: str = VALID_JSON,
    finish: genai_types.FinishReason = genai_types.FinishReason.STOP,
):
    return SimpleNamespace(
        usage_metadata=SimpleNamespace(
            prompt_token_count=2000,
            candidates_token_count=700,
            thoughts_token_count=300,
        ),
        candidates=[SimpleNamespace(finish_reason=finish)],
        text=text,
    )


@pytest.fixture
def fake_gemini(monkeypatch: pytest.MonkeyPatch):
    models = FakeGeminiModels(gemini_response())
    monkeypatch.setattr(providers, "_api_key", lambda var: "test-key")
    monkeypatch.setattr(
        providers, "_gemini_client", lambda key: SimpleNamespace(models=models)
    )
    return models


def test_gemini_sends_the_file_inline_with_the_json_schema(fake_gemini):
    output = call_gemini(b"%PDF-bytes", "application/pdf", model=GEMINI_FLASH)
    assert output.extraction == clean_extraction()
    assert output.usage == Usage(2000, 1000)  # thinking tokens are billed output

    kwargs = fake_gemini.kwargs
    assert kwargs["model"] == GEMINI_FLASH
    part = kwargs["contents"][0]
    assert part.inline_data.data == b"%PDF-bytes"
    assert part.inline_data.mime_type == "application/pdf"
    config = kwargs["config"]
    assert config.system_instruction == SYSTEM_PROMPT
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == gemini_schema(
        BillExtraction.model_json_schema()
    )
    assert config.thinking_config.thinking_level == genai_types.ThinkingLevel.LOW


def test_gemini_output_that_does_not_fit_fails_with_usage(fake_gemini):
    fake_gemini.response = gemini_response('{"document_type": "invoice"}')
    with pytest.raises(InvalidOutputError) as raised:
        call_gemini(b"%PDF", "application/pdf", model=GEMINI_FLASH)
    assert raised.value.usage == Usage(2000, 1000)


def test_gemini_truncated_output_fails(fake_gemini):
    fake_gemini.response = gemini_response(
        VALID_JSON[:50], genai_types.FinishReason.MAX_TOKENS
    )
    with pytest.raises(ProviderError, match="model stopped: MAX_TOKENS"):
        call_gemini(b"%PDF", "application/pdf", model=GEMINI_FLASH)

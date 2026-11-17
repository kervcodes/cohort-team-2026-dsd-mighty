"""A scripted stand-in for the Claude client, for the payment agent tests.

`ScriptedModel(script)` has the one method the agent uses,
`beta.messages.create`. Each call answers with the next turn of the script as
a real SDK `BetaMessage` (so the agent handles the same types it gets from the
API) and keeps the request, JSON-encoded, in `requests`, so a test can check
what the model was sent. No network, no key. Helpers, not tests.
"""

import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

from anthropic.types.beta import BetaMessage

Turn = dict[str, Any] | Callable[[], Any]


def tool(name: str, **arguments: str) -> Turn:
    return {"stop_reason": "tool_use", "tool": (name, arguments)}


END = {"stop_reason": "end_turn", "text": "Done."}
REFUSAL = {"stop_reason": "refusal", "text": ""}

HAPPY_PATH = [
    tool("load_approved_bill"),
    tool("sign_in"),
    tool("list_portal_bills"),
    tool("pay", bill_number="BILL-1001"),  # pays, records and ends the run
]


def _encode(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError(f"cannot encode {type(value).__name__}")


class ScriptedModel:
    def __init__(self, script: list[Turn]) -> None:
        self._script = list(script)
        self.requests: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def sent(self) -> str:
        """Everything the agent sent to the model, as one string."""
        return json.dumps(self.requests)

    def _create(self, **request: Any) -> BetaMessage:
        self.requests.append(json.loads(json.dumps(request, default=_encode)))
        number = len(self.requests)
        turn = self._script.pop(0) if self._script else END
        if callable(turn):
            return turn()  # raises, e.g. an API error

        content: list[dict[str, Any]] = [
            # Adaptive thinking: the agent must pass these back unchanged.
            {"type": "thinking", "thinking": "", "signature": f"sig-{number}"}
        ]
        if "tool" in turn:
            name, arguments = turn["tool"]
            content.append(
                {
                    "type": "tool_use",
                    "id": f"toolu_{number:02d}",
                    "name": name,
                    "input": arguments,
                }
            )
        else:
            content.append({"type": "text", "text": turn["text"]})
        return BetaMessage.model_validate(
            {
                "id": f"msg_{number:02d}",
                "type": "message",
                "role": "assistant",
                "model": request["model"],
                "content": content,
                "stop_reason": turn["stop_reason"],
                "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 10},
            }
        )

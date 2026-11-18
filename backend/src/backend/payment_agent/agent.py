"""`run_payment(run_id)`: one payment run, from claimed to paid, failed or
flagged.

The loop is a manual Claude tool-use loop (adaptive thinking, one tool call
per turn) with limits in code: at most `max_model_turns` model calls and
`time_limit_seconds` of wall clock, checked before every model call and every
tool call. The worker can pull that deadline in (`must_end_by`) when it is
told to stop, so a deploy ends a run the same way the time limit does. The
run always ends with a status:

- pay ends it: once the portal may have the payment, pay records the
  receipt (paid or failed) or flags the run, before the model calls anything
  else, so a payment that went through is never left unrecorded;
- the model calls flag_for_person, or a tool's check flags the run;
- otherwise (the model stops, refuses, errors, or a limit is hit) code flags
  it.
"""

import logging
import time
import traceback
from collections.abc import Callable
from typing import Any
from uuid import UUID

import anthropic

from backend.payment_agent.model import (
    FALLBACK_BETA,
    MAX_OUTPUT_TOKENS,
    AgentConfig,
    ModelClient,
    agent_config,
    create_model_client,
)
from backend.payment_agent.playwright_portal import PlaywrightPortal
from backend.payment_agent.portal import PortalDriver
from backend.payment_agent.prompt import KICKOFF, SYSTEM_PROMPT, TOOLS
from backend.payment_agent.tools import (
    OpenPortal,
    PaymentTools,
    Redactor,
    RunLog,
    RunTaken,
    tool_result_block,
)
from backend.schemas.payment_run import PaymentRunStatus
from backend.services.payment_run_repository import finish_run, get_run, new_step
from backend.supabase_client import get_admin_supabase
from supabase import Client

logger = logging.getLogger(__name__)

Clock = Callable[[], float]

# Why a run must stop now, checked before every model and tool call; None
# while it may go on.
StopCheck = Callable[[], str | None]

TIME_LIMIT = "The run hit its time limit."
WORKER_STOPPING = (
    "The worker was stopped (a deploy or restart) before the run finished."
)


def _no_shutdown() -> float | None:
    return None


class _Stop(Exception):
    """The loop ended without a tool ending the run; the message says why."""


def _open_playwright(config: AgentConfig) -> OpenPortal:
    def open_portal(url: str) -> PortalDriver:
        return PlaywrightPortal(url, timeout_ms=config.portal_timeout_ms)

    return open_portal


def _ask(client: ModelClient, config: AgentConfig, messages: list) -> Any:
    return client.beta.messages.create(
        model=config.model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=SYSTEM_PROMPT,
        tools=TOOLS,
        tool_choice={"type": "auto", "disable_parallel_tool_use": True},
        thinking={"type": "adaptive"},
        output_config={"effort": config.effort},
        betas=[FALLBACK_BETA],
        fallbacks="default",
        messages=messages,
    )


def _loop(
    tools: PaymentTools,
    client: ModelClient,
    config: AgentConfig,
    redactor: Redactor,
    must_stop: StopCheck,
) -> None:
    """Drive the model until a tool ends the run. Raises _Stop otherwise."""
    messages: list[dict[str, Any]] = [{"role": "user", "content": KICKOFF}]
    for _turn in range(config.max_model_turns):
        if (why := must_stop()) is not None:
            raise _Stop(why)
        try:
            response = _ask(client, config, messages)
        except anthropic.APIError as error:
            reason = f"The model could not be reached ({type(error).__name__})."
            raise _Stop(reason) from None

        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "refusal":
            raise _Stop("The model declined to continue.")
        if response.stop_reason != "tool_use":
            raise _Stop(
                f"The agent stopped without finishing ({response.stop_reason})."
            )

        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            if (why := must_stop()) is not None:
                raise _Stop(why)
            arguments = block.input if isinstance(block.input, dict) else {}
            result = tools.call(block.name, arguments)
            results.append(tool_result_block(block.id, result, redactor))
            if tools.end is not None:
                return
        messages.append({"role": "user", "content": results})
    raise _Stop(f"The run hit its limit of {config.max_model_turns} model turns.")


def run_payment(
    run_id: UUID,
    *,
    supabase: Client | None = None,
    model_client: ModelClient | None = None,
    open_portal: OpenPortal | None = None,
    config: AgentConfig | None = None,
    clock: Clock = time.monotonic,
    must_end_by: Callable[[], float | None] = _no_shutdown,
) -> PaymentRunStatus | None:
    """Run the claimed (running) payment run `run_id` to its end and return
    its final status, or None when the run is not running (another worker or
    the stale-run check ended it).

    `must_end_by` returns a `clock` time by which the run must stop, or None;
    the worker sets one when it gets SIGTERM. Past it, the run ends like at
    its time limit: a portal result already given is saved, else it is
    flagged."""
    supabase = supabase or get_admin_supabase()
    config = config or agent_config()
    run = get_run(supabase, run_id)
    if run is None or run.status is not PaymentRunStatus.running:
        logger.warning("payment run %s is not running; skipped", run_id)
        return None

    redactor = Redactor()
    log = RunLog(supabase, run, redactor)
    tools = PaymentTools(
        supabase=supabase,
        run=run,
        open_portal=open_portal or _open_playwright(config),
        log=log,
        redactor=redactor,
    )
    deadline = clock() + config.time_limit_seconds

    def must_stop() -> str | None:
        now = clock()
        if now > deadline:
            return TIME_LIMIT
        end_by = must_end_by()
        if end_by is not None and now > end_by:
            return WORKER_STOPPING
        return None

    try:
        log.add("started", f"Payment agent started ({config.model}).")
        try:
            client = model_client or create_model_client()
            _loop(tools, client, config, redactor, must_stop)
        except _Stop as stop:
            tools.flag(str(stop))
        except RunTaken:
            raise
        except Exception as error:
            # A bug, not a portal problem: keep the traceback for the log, with
            # any secret scrubbed out of it.
            details = redactor.scrub("".join(traceback.format_exception(error)))
            logger.error("payment run %s crashed:\n%s", run_id, details)
            tools.flag(f"The agent hit an unexpected error ({type(error).__name__}).")
    except RunTaken:
        logger.warning("payment run %s was ended elsewhere; stopped", run_id)
        return None
    finally:
        tools.close()

    end = tools.end
    assert end is not None, "every path above ends the run"
    log.steps.append(new_step("finished", f"Run ended: {end.status.value}."))
    if not finish_run(
        supabase,
        run_id,
        status=end.status,
        steps=log.steps,
        flag_reason=end.flag_reason,
        receipt=end.receipt,
        payment_id=end.payment_id,
    ):
        logger.warning("payment run %s was ended elsewhere before saving", run_id)
        return None
    logger.info("payment run %s finished: %s", run_id, end.status.value)
    return end.status

"""The payment agent worker: `uv run python -m backend.payment_agent.worker`.

Loops: claim the oldest queued payment run, run it, and sleep a few seconds
when the queue is empty, logging a heartbeat line once a minute while idle.
`--once` runs at most one run and exits (for local testing);
`--check-browser` only starts Chromium the way a run does and exits (the
image's smoke check, no settings or keys needed).

SIGTERM or SIGINT stops it gracefully: it claims nothing more, and a run in
progress gets until the shutdown deadline to finish. The deadline is
`PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS` (Render's `maxShutdownDelaySeconds`,
after which Render sends SIGKILL) minus `WRAP_UP_RESERVE_SECONDS`, the time
one last model call and saving the result can take. Past it the run ends
like at its time limit: a portal result already given is saved, else the run
is flagged. A worker killed mid-run anyway leaves the run running; the next
claim flags it after 15 minutes (see claim_next_payment_run), so nobody pays
twice by retrying.
"""

import argparse
import logging
import os
import signal
import threading
import time
from collections.abc import Callable
from types import FrameType

import dotenv

from backend.log_setup import configure_logging
from backend.payment_agent.agent import run_payment
from backend.payment_agent.model import (
    ENV_FILE,
    MAX_RETRIES,
    TIMEOUT_SECONDS,
    ModelClient,
    agent_config,
    create_model_client,
)
from backend.payment_agent.playwright_portal import CHROMIUM_ARGS, PlaywrightPortal
from backend.services.payment_run_repository import claim_next_run
from backend.supabase_client import get_admin_supabase
from supabase import Client

# Not __name__: run with `python -m` that is "__main__", outside the `backend`
# logger configure_logging sets up, and every line here would be dropped.
logger = logging.getLogger("backend.payment_agent.worker")

IDLE_SECONDS = 5.0
HEARTBEAT_SECONDS = 60.0

SHUTDOWN_DELAY_SETTING = "PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS"
# Render's default; set both to 300 (Render's maximum) in production.
DEFAULT_SHUTDOWN_DELAY_SECONDS = 30
MAX_SHUTDOWN_DELAY_SECONDS = 300
# After the run's deadline, one model call already in flight can still take
# its full timeout on every attempt, and then the result is saved.
WRAP_UP_RESERVE_SECONDS = TIMEOUT_SECONDS * (MAX_RETRIES + 1) + 20

Clock = Callable[[], float]


def _no_shutdown() -> float | None:
    return None


def work(
    supabase: Client,
    model_client: ModelClient,
    stop: threading.Event,
    *,
    once: bool = False,
    idle_seconds: float = IDLE_SECONDS,
    heartbeat_seconds: float = HEARTBEAT_SECONDS,
    must_end_by: Callable[[], float | None] = _no_shutdown,
    run: Callable[..., object] = run_payment,
    clock: Clock = time.monotonic,
) -> int:
    """Claim and run payment runs until `stop` is set (or one run, with
    `once`). Returns how many runs it ran. `must_end_by` is passed to every
    run (see run_payment)."""
    ran = 0
    last_heartbeat = clock()
    while not stop.is_set():
        try:
            claimed = claim_next_run(supabase)
        except Exception:
            logger.exception("Could not claim a payment run; retrying")
            claimed = None
        if claimed is None:
            if once:
                break
            if clock() - last_heartbeat >= heartbeat_seconds:
                logger.info(
                    "Payment agent worker alive, idle (%d run(s) since start)", ran
                )
                last_heartbeat = clock()
            stop.wait(idle_seconds)
            continue

        logger.info("Claimed payment run %s", claimed.id)
        try:
            run(
                claimed.id,
                supabase=supabase,
                model_client=model_client,
                must_end_by=must_end_by,
            )
        except Exception:
            # The run stays running; the stale-run check flags it later.
            logger.exception("Payment run %s crashed", claimed.id)
        ran += 1
        last_heartbeat = clock()
        if once:
            break
    return ran


def shutdown_delay_seconds() -> int:
    """`PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS`: Render's shutdown delay for
    this service (1 to 300, default 30). Malformed values stop the worker at
    start, so a typo never shortens or stretches the deadline silently."""
    dotenv.load_dotenv(ENV_FILE)  # does not override variables already set
    raw = os.environ.get(SHUTDOWN_DELAY_SETTING, "").strip()
    if not raw:
        return DEFAULT_SHUTDOWN_DELAY_SECONDS
    try:
        delay = int(raw)
    except ValueError:
        delay = 0
    if not 1 <= delay <= MAX_SHUTDOWN_DELAY_SECONDS:
        raise RuntimeError(
            f"{SHUTDOWN_DELAY_SETTING} must be a whole number of seconds from 1 "
            f"to {MAX_SHUTDOWN_DELAY_SECONDS}, the same as the service's shutdown "
            "delay on Render; see docs/payment-worker.md"
        )
    return delay


def check_browser() -> None:
    """Start Chromium the way a run does, render a page, and close it."""
    with PlaywrightPortal("about:blank") as portal:
        version = portal.check()
    logger.info(
        "Browser check passed: Chromium %s started with %s",
        version,
        " ".join(CHROMIUM_ARGS),
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m backend.payment_agent.worker",
        description="Pay queued payment runs on vendor portals.",
    )
    parser.add_argument(
        "--once", action="store_true", help="run at most one payment run and exit"
    )
    parser.add_argument(
        "--idle-seconds",
        type=float,
        default=IDLE_SECONDS,
        help="how long to sleep when nothing is queued",
    )
    parser.add_argument(
        "--check-browser",
        action="store_true",
        help="start Chromium once and exit (needs no settings or keys)",
    )
    args = parser.parse_args(argv)

    configure_logging()
    if args.check_browser:
        check_browser()
        return

    # Fail at start, not on the first run, when the key or settings are missing.
    supabase = get_admin_supabase()
    model_client = create_model_client()
    delay = shutdown_delay_seconds()
    wrap_up = max(0, delay - WRAP_UP_RESERVE_SECONDS)
    logger.info(
        "Payment agent worker started: model %s, idle sleep %gs, heartbeat "
        "every %gs, shutdown delay %ds (a run in progress gets %ds to finish "
        "after SIGTERM)",
        agent_config().model,
        args.idle_seconds,
        HEARTBEAT_SECONDS,
        delay,
        wrap_up,
    )
    if wrap_up == 0:
        logger.warning(
            "A shutdown delay of %ds leaves no time to finish a run (it needs "
            "%ds of reserve): a deploy flags a run in progress and may kill it "
            "mid-call. Set %s and Render's shutdown delay to %d.",
            delay,
            WRAP_UP_RESERVE_SECONDS,
            SHUTDOWN_DELAY_SETTING,
            MAX_SHUTDOWN_DELAY_SECONDS,
        )

    stop = threading.Event()
    run_must_end_by: float | None = None

    def request_stop(signum: int, _frame: FrameType | None) -> None:
        nonlocal run_must_end_by
        if run_must_end_by is None:
            run_must_end_by = time.monotonic() + wrap_up
        logger.info(
            "Got %s; claiming nothing more, a run in progress has %ds to finish",
            signal.Signals(signum).name,
            wrap_up,
        )
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    ran = work(
        supabase,
        model_client,
        stop,
        once=args.once,
        idle_seconds=args.idle_seconds,
        must_end_by=lambda: run_must_end_by,
    )
    logger.info("Payment agent worker stopped after %d run(s)", ran)


if __name__ == "__main__":
    main()

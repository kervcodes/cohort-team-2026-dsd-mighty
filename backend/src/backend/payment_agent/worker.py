"""The payment agent worker: `uv run python -m backend.payment_agent.worker`.

Loops: claim the oldest queued payment run, run it, and sleep a few seconds
when the queue is empty. `--once` runs at most one run and exits (for local
testing).

SIGTERM or SIGINT stops it gracefully: a run in progress finishes (it has its
own time limit), then the worker exits without claiming another. A worker
killed mid-run leaves the run running; the next claim flags it after 15
minutes (see claim_next_payment_run), so nobody pays twice by retrying.
"""

import argparse
import logging
import signal
import threading
from collections.abc import Callable
from types import FrameType

from backend.log_setup import configure_logging
from backend.payment_agent.agent import run_payment
from backend.payment_agent.model import ModelClient, agent_config, create_model_client
from backend.services.payment_run_repository import claim_next_run
from backend.supabase_client import get_admin_supabase
from supabase import Client

logger = logging.getLogger(__name__)

IDLE_SECONDS = 5.0


def work(
    supabase: Client,
    model_client: ModelClient,
    stop: threading.Event,
    *,
    once: bool = False,
    idle_seconds: float = IDLE_SECONDS,
    run: Callable[..., object] = run_payment,
) -> int:
    """Claim and run payment runs until `stop` is set (or one run, with
    `once`). Returns how many runs it ran."""
    ran = 0
    while not stop.is_set():
        try:
            claimed = claim_next_run(supabase)
        except Exception:
            logger.exception("Could not claim a payment run; retrying")
            claimed = None
        if claimed is None:
            if once:
                break
            stop.wait(idle_seconds)
            continue

        logger.info("Claimed payment run %s", claimed.id)
        try:
            run(claimed.id, supabase=supabase, model_client=model_client)
        except Exception:
            # The run stays running; the stale-run check flags it later.
            logger.exception("Payment run %s crashed", claimed.id)
        ran += 1
        if once:
            break
    return ran


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
    args = parser.parse_args(argv)

    configure_logging()
    # Fail at start, not on the first run, when the key or settings are missing.
    supabase = get_admin_supabase()
    model_client = create_model_client()
    logger.info("Payment agent worker started (model %s)", agent_config().model)

    stop = threading.Event()

    def request_stop(signum: int, _frame: FrameType | None) -> None:
        logger.info(
            "Got %s; stopping after the current run", signal.Signals(signum).name
        )
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    ran = work(
        supabase, model_client, stop, once=args.once, idle_seconds=args.idle_seconds
    )
    logger.info("Payment agent worker stopped after %d run(s)", ran)


if __name__ == "__main__":
    main()

"""The worker loop (`python -m backend.payment_agent.worker`) and the claim
function's Python twin. The SQL function itself is tested in
backend/supabase/tests/payment_runs.test.sql."""

import signal
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from fake_supabase import FakeSupabase

from backend.payment_agent import worker
from backend.services.payment_run_repository import claim_next_run

USER = str(uuid4())


def queued(db: FakeSupabase, minutes_ago: int = 0) -> dict:
    bill = db.add_bill(USER, status="approved", amount="10.00")
    created = (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat()
    return db.add_payment_run(bill["bill_id"], USER, created_at=created)


def test_claim_takes_the_oldest_queued_run_and_marks_it_running():
    db = FakeSupabase()
    newer, older = queued(db, 1), queued(db, 5)

    claimed = claim_next_run(db)

    assert claimed is not None and str(claimed.id) == older["run_id"]
    assert older["status"] == "running" and older["started_at"]
    assert older["steps"][-1]["step"] == "claimed"
    assert newer["status"] == "queued"


def test_claim_flags_runs_left_running_and_returns_none_when_empty():
    db = FakeSupabase()
    stale = queued(db, 40)
    stale.update(
        status="running",
        started_at=(datetime.now(UTC) - timedelta(minutes=30)).isoformat(),
    )

    assert claim_next_run(db) is None
    assert stale["status"] == "flagged"
    assert "Check the vendor portal" in stale["flag_reason"]


def test_work_once_runs_one_claimed_run():
    db = FakeSupabase()
    first, second = queued(db, 5), queued(db, 1)
    ran: list = []

    count = worker.work(
        db,
        object(),
        threading.Event(),
        once=True,
        run=lambda run_id, **_: ran.append(run_id),
    )

    assert count == 1
    assert [str(run_id) for run_id in ran] == [first["run_id"]]
    assert second["status"] == "queued"


def test_work_once_with_nothing_queued_exits_without_waiting():
    stop = threading.Event()
    with patch.object(stop, "wait") as wait:
        count = worker.work(FakeSupabase(), object(), stop, once=True)

    assert count == 0
    wait.assert_not_called()


def test_work_sleeps_when_idle_and_stops_when_asked():
    stop = threading.Event()
    waits: list[float] = []

    def wait(seconds: float) -> bool:
        waits.append(seconds)
        stop.set()  # as SIGTERM would
        return True

    with patch.object(stop, "wait", side_effect=wait):
        count = worker.work(FakeSupabase(), object(), stop, idle_seconds=2.5)

    assert count == 0
    assert waits == [2.5]


def test_work_keeps_going_after_a_run_crashes(caplog):
    db = FakeSupabase()
    queued(db, 5)
    queued(db, 1)
    stop = threading.Event()
    ran: list = []

    def crash_then_stop(run_id, **_):
        ran.append(run_id)
        if len(ran) == 2:
            stop.set()
        raise RuntimeError("bug")

    count = worker.work(db, object(), stop, run=crash_then_stop)

    assert count == 2
    assert "crashed" in caplog.text


def test_a_set_stop_claims_nothing():
    db = FakeSupabase()
    run = queued(db)
    stop = threading.Event()
    stop.set()

    assert worker.work(db, object(), stop) == 0
    assert run["status"] == "queued"


def test_work_passes_the_shutdown_deadline_to_each_run():
    db = FakeSupabase()
    queued(db)
    seen: list = []

    def must_end_by() -> float | None:
        return 42.0

    worker.work(
        db,
        object(),
        threading.Event(),
        once=True,
        must_end_by=must_end_by,
        run=lambda _run_id, **kwargs: seen.append(kwargs["must_end_by"]()),
    )

    assert seen == [42.0]


def test_idle_worker_logs_a_heartbeat_once_a_minute(caplog):
    caplog.set_level("INFO", logger="backend")
    stop = threading.Event()
    now = [0.0]
    waits: list[float] = []

    def wait(seconds: float) -> bool:
        waits.append(seconds)
        now[0] += 20.0  # each idle sleep, as the clock sees it
        if len(waits) == 13:  # idle for 260 seconds
            stop.set()
        return stop.is_set()

    with patch.object(stop, "wait", side_effect=wait):
        worker.work(FakeSupabase(), object(), stop, clock=lambda: now[0])

    beats = [r for r in caplog.records if "worker alive" in r.getMessage()]
    assert len(beats) == 4  # at 60, 120, 180 and 240 seconds
    assert "idle (0 run(s) since start)" in beats[0].getMessage()


def test_a_busy_worker_logs_no_heartbeat(caplog):
    caplog.set_level("INFO", logger="backend")
    db = FakeSupabase()
    queued(db, 2)
    queued(db, 1)
    stop = threading.Event()
    now = [0.0]

    def slow_run(_run_id, **_):
        now[0] += 120.0
        if not db.find("payment_runs", "status", "queued"):
            stop.set()

    worker.work(db, object(), stop, run=slow_run, clock=lambda: now[0])

    assert "worker alive" not in caplog.text


def run_main(*argv: str, env: dict[str, str] | None = None):
    """worker.main with fakes; returns the `work` mock and the signal
    handlers it installed."""
    handlers = {}
    with (
        patch.dict(worker.os.environ, env or {}),
        patch.object(worker.dotenv, "load_dotenv"),
        patch.object(worker, "get_admin_supabase", return_value=FakeSupabase()),
        patch.object(worker, "create_model_client", return_value=object()),
        patch.object(worker, "configure_logging"),
        patch.object(
            worker.signal, "signal", lambda sig, fn: handlers.update({sig: fn})
        ),
        patch.object(worker, "work", return_value=0) as work,
    ):
        worker.main(list(argv))
    return work, handlers


def test_main_runs_once_and_sigterm_stops_the_loop():
    work, handlers = run_main("--once", "--idle-seconds", "1")

    _db, _client, stop = work.call_args.args
    kwargs = work.call_args.kwargs
    assert (kwargs["once"], kwargs["idle_seconds"]) == (True, 1.0)
    assert not stop.is_set()
    assert kwargs["must_end_by"]() is None
    handlers[signal.SIGTERM](signal.SIGTERM, None)
    assert stop.is_set()
    assert signal.SIGINT in handlers


def test_sigterm_gives_a_run_the_shutdown_delay_minus_the_reserve():
    delay = worker.MAX_SHUTDOWN_DELAY_SECONDS
    work, handlers = run_main(env={worker.SHUTDOWN_DELAY_SETTING: str(delay)})
    must_end_by = work.call_args.kwargs["must_end_by"]

    before = time.monotonic()
    handlers[signal.SIGTERM](signal.SIGTERM, None)
    first = must_end_by()
    handlers[signal.SIGINT](signal.SIGINT, None)  # a second signal moves nothing

    wrap_up = delay - worker.WRAP_UP_RESERVE_SECONDS
    assert wrap_up >= 60  # enough for most runs to finish on their own
    assert before + wrap_up <= first <= time.monotonic() + wrap_up
    assert must_end_by() == first


def test_default_shutdown_delay_ends_a_run_at_once_and_warns(caplog):
    caplog.set_level("INFO", logger="backend")
    work, handlers = run_main(env={worker.SHUTDOWN_DELAY_SETTING: ""})

    handlers[signal.SIGTERM](signal.SIGTERM, None)

    assert work.call_args.kwargs["must_end_by"]() <= time.monotonic()
    assert "leaves no time to finish a run" in caplog.text


@pytest.mark.parametrize("value", ["0", "301", "-5", "30s", "2.5"])
def test_malformed_shutdown_delay_stops_the_worker_at_start(value):
    with pytest.raises(RuntimeError, match=worker.SHUTDOWN_DELAY_SETTING):
        run_main(env={worker.SHUTDOWN_DELAY_SETTING: value})


def test_startup_line_names_the_settings_and_no_secret(caplog):
    caplog.set_level("INFO", logger="backend")
    secret = "sk-ant-not-a-real-key"
    run_main(
        env={
            worker.SHUTDOWN_DELAY_SETTING: "300",
            "PAYMENT_AGENT_MODEL": "claude-test-model",
            "ANTHROPIC_API_KEY": secret,
        }
    )

    started = next(r for r in caplog.records if "worker started" in r.getMessage())
    line = started.getMessage()
    assert "claude-test-model" in line and "idle sleep 5s" in line
    assert "shutdown delay 300s" in line and "100s to finish" in line
    assert secret not in caplog.text


def test_check_browser_starts_chromium_without_settings_or_keys(caplog):
    caplog.set_level("INFO", logger="backend")
    with (
        patch.object(worker, "configure_logging"),
        patch.object(worker, "get_admin_supabase") as supabase,
        patch.object(worker, "create_model_client") as model,
    ):
        worker.main(["--check-browser"])

    assert "Browser check passed: Chromium" in caplog.text
    assert "--disable-dev-shm-usage" in caplog.text
    supabase.assert_not_called()
    model.assert_not_called()


def test_worker_log_lines_reach_stderr_when_run_as_a_module():
    """The way Render and the docs start it: `python -m ...` names the module
    `__main__`, so its logger must still be under `backend`."""
    result = subprocess.run(
        [sys.executable, "-m", "backend.payment_agent.worker", "--check-browser"],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "backend.payment_agent.worker - Browser check passed" in result.stderr

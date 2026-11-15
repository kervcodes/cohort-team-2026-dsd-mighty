"""The worker loop (`python -m backend.payment_agent.worker`) and the claim
function's Python twin. The SQL function itself is tested in
backend/supabase/tests/payment_runs.test.sql."""

import signal
import threading
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

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


def test_main_runs_once_and_sigterm_stops_the_loop():
    handlers = {}
    with (
        patch.object(worker, "get_admin_supabase", return_value=FakeSupabase()),
        patch.object(worker, "create_model_client", return_value=object()),
        patch.object(worker, "configure_logging"),
        patch.object(
            worker.signal, "signal", lambda sig, fn: handlers.update({sig: fn})
        ),
        patch.object(worker, "work", return_value=0) as work,
    ):
        worker.main(["--once", "--idle-seconds", "1"])

    _db, _client, stop = work.call_args.args
    assert work.call_args.kwargs == {"once": True, "idle_seconds": 1.0}
    assert not stop.is_set()
    handlers[signal.SIGTERM](signal.SIGTERM, None)
    assert stop.is_set()
    assert signal.SIGINT in handlers

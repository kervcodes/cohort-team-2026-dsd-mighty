"""Reads and writes `public.payment_runs` (migration 20261117110000_payment_runs).

The table names its key `run_id`; the API calls it `id`. The routes queue and
read runs; the payment agent worker claims them with `claim_next_payment_run`
and, while a run is running, is its only writer. Every agent write is guarded
by `status = running`, so a run that was flagged elsewhere (a stale run the
claim function gave up on) is never overwritten or carried on.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from postgrest.exceptions import APIError

from backend.schemas.payment_run import (
    PaymentRunRead,
    PaymentRunReceipt,
    PaymentRunStatus,
    PaymentRunStep,
)
from supabase import Client

RUN_COLUMNS = (
    "run_id,bill_id,started_by,status,steps,flag_reason,receipt,payment_id,"
    "created_at,started_at,finished_at,updated_at"
)

UNIQUE_VIOLATION = "23505"

FINAL_STATUSES = (
    PaymentRunStatus.paid,
    PaymentRunStatus.flagged,
    PaymentRunStatus.failed,
)


class RunAlreadyActive(Exception):
    """The bill already has a queued or running run."""


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_step(step: str, detail: str) -> PaymentRunStep:
    return PaymentRunStep(at=datetime.now(UTC), step=step, detail=detail)


def _to_run(row: dict[str, Any]) -> PaymentRunRead:
    return PaymentRunRead.model_validate({**row, "id": row["run_id"]})


def _steps_json(steps: list[PaymentRunStep]) -> list[dict[str, Any]]:
    return [step.model_dump(mode="json") for step in steps]


def queue_run(
    client: Client, bill_id: UUID, started_by: UUID, first_step: PaymentRunStep
) -> PaymentRunRead:
    """Insert a queued run. Raises RunAlreadyActive when the bill has one."""
    payload = {
        "bill_id": str(bill_id),
        "started_by": str(started_by),
        "status": PaymentRunStatus.queued.value,
        "steps": _steps_json([first_step]),
    }
    try:
        response = client.table("payment_runs").insert(payload).execute()
    except APIError as error:
        # payment_runs_one_active_per_bill
        if error.code == UNIQUE_VIOLATION:
            raise RunAlreadyActive from error
        raise

    return _to_run(response.data[0])


def list_bill_runs(client: Client, bill_id: UUID) -> list[PaymentRunRead]:
    """The bill's runs, newest first."""
    response = (
        client.table("payment_runs")
        .select(RUN_COLUMNS)
        .eq("bill_id", str(bill_id))
        .order("created_at", desc=True)
        .execute()
    )
    return [_to_run(row) for row in response.data or []]


def get_run(client: Client, run_id: UUID) -> PaymentRunRead | None:
    response = (
        client.table("payment_runs")
        .select(RUN_COLUMNS)
        .eq("run_id", str(run_id))
        .maybe_single()
        .execute()
    )
    # maybe_single() returns None (not an empty result) when no row matches.
    row = response.data if response is not None else None
    return _to_run(row) if isinstance(row, dict) else None


def claim_next_run(client: Client) -> PaymentRunRead | None:
    """Take the oldest queued run and mark it running (the SQL function locks
    with `skip locked`, so concurrent workers never share a run)."""
    response = client.rpc("claim_next_payment_run", {}).execute()
    rows = response.data or []
    return _to_run(rows[0]) if rows else None


def _update_running(client: Client, run_id: UUID, payload: dict[str, Any]) -> bool:
    response = (
        client.table("payment_runs")
        .update(payload)
        .eq("run_id", str(run_id))
        .eq("status", PaymentRunStatus.running.value)
        .execute()
    )
    return len(response.data or []) == 1


def save_steps(client: Client, run_id: UUID, steps: list[PaymentRunStep]) -> bool:
    """Write the run's steps. False when the run is no longer running."""
    return _update_running(client, run_id, {"steps": _steps_json(steps)})


def finish_run(
    client: Client,
    run_id: UUID,
    *,
    status: PaymentRunStatus,
    steps: list[PaymentRunStep],
    flag_reason: str | None = None,
    receipt: PaymentRunReceipt | None = None,
    payment_id: UUID | None = None,
) -> bool:
    """End a running run. False when the run is no longer running."""
    if status not in FINAL_STATUSES:
        raise ValueError(f"{status} is not a final status")
    return _update_running(
        client,
        run_id,
        {
            "status": status.value,
            "steps": _steps_json(steps),
            "flag_reason": flag_reason,
            "receipt": receipt.model_dump(mode="json") if receipt else None,
            "payment_id": str(payment_id) if payment_id else None,
            "finished_at": now_iso(),
        },
    )

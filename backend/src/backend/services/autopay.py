"""Autopay (DC-86): reads and writes `public.autopay_settings`, and queues a
payment run when a bill is approved under the limit.

A person still approves every bill; autopay only does what pressing Pay with
AI would, through the same `queue_payment_run` and its checks. Queueing never
fails an approval: the decision is already committed when autopay runs, and
`queue_autopay_run` logs and swallows every error, so the bill stays approved
and a person can still press Pay with AI.
"""

import logging
from typing import Any
from uuid import UUID

from backend.schemas.autopay import AutopaySettingsRead, AutopaySettingsUpdate
from backend.schemas.payment_run import PaymentRunRead, PaymentRunTrigger
from backend.services.bill_repository import get_readable_bill
from backend.services.payment_run_queue import RunNotQueued, queue_payment_run
from supabase import Client

logger = logging.getLogger(__name__)

SETTINGS_COLUMNS = (
    "enabled,limit_amount,updated_by,updated_at,"
    # The last changer's current name, through autopay_settings.updated_by.
    "updater:app_users!updated_by(full_name)"
)

# The table's only key (migration 20261117140000_autopay).
THE_ROW = True


def _to_settings(row: dict[str, Any]) -> AutopaySettingsRead:
    updater = row.get("updater")
    return AutopaySettingsRead.model_validate(
        {**row, "updated_by_name": updater["full_name"] if updater else None}
    )


def get_autopay_settings(client: Client) -> AutopaySettingsRead:
    response = (
        client.table("autopay_settings")
        .select(SETTINGS_COLUMNS)
        .eq("id", THE_ROW)
        .single()
        .execute()
    )
    return _to_settings(response.data)


def update_autopay_settings(
    client: Client, change: AutopaySettingsUpdate, updated_by: UUID
) -> AutopaySettingsRead:
    """Save the setting and who changed it; the database stamps updated_at."""
    limit = change.limit_amount
    (
        client.table("autopay_settings")
        .update(
            {
                "enabled": change.enabled,
                "limit_amount": None if limit is None else str(limit),
                "updated_by": str(updated_by),
            }
        )
        .eq("id", THE_ROW)
        .execute()
    )
    return get_autopay_settings(client)


def _skip(bill_id: UUID, reason: str) -> None:
    # Metadata only: the bill id and a reason code, never amounts or logins.
    logger.info("Autopay did not queue a run for bill %s: %s.", bill_id, reason)


def _queue_if_under_limit(
    client: Client, bill_id: UUID, approver_id: UUID, approver_name: str
) -> PaymentRunRead | None:
    settings = get_autopay_settings(client)
    if not settings.enabled or settings.limit_amount is None:
        return _skip(bill_id, "autopay_off")

    bill = get_readable_bill(client, bill_id, approver_id)
    if bill is None:
        return _skip(bill_id, "bill_not_found")
    if bill.amount is None or bill.amount > settings.limit_amount:
        return _skip(bill_id, "over_limit")

    try:
        run = queue_payment_run(
            client,
            bill,
            started_by=approver_id,
            trigger=PaymentRunTrigger.autopay,
            first_step=f"Queued by autopay after approval by {approver_name}.",
        )
    except RunNotQueued as exc:
        return _skip(bill_id, exc.refusal.value)

    logger.info("Autopay queued payment run %s for bill %s.", run.id, bill_id)
    return run


def queue_autopay_run(
    client: Client, bill_id: UUID, approver_id: UUID, approver_name: str
) -> PaymentRunRead | None:
    """Call right after `bill_id` was approved by `approver_id`. Queues a run
    started by the approver when autopay is on and the bill is within the
    limit and payable; otherwise, or on any error, returns None. Never raises."""
    try:
        return _queue_if_under_limit(client, bill_id, approver_id, approver_name)
    except Exception:
        logger.exception(
            "Autopay could not queue a run for bill %s; the bill stays approved.",
            bill_id,
        )
        return None

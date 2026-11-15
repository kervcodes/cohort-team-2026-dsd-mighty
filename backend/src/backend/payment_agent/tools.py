"""The payment agent's tools, and every safety check behind them.

The model chooses which tool to call next; this module decides whether doing
it is safe. Each refusal ends the run as flagged with a reason a person can
act on, and nothing is paid. Rules enforced here, not by the prompt:

- Only an approved bill, matched to an active vendor account with a portal
  login, on an https portal (http only for a local test server).
- The model never sees the password: `sign_in` reads it from Vault and types
  it; every step, tool result and flag reason is scrubbed of it.
- One pay attempt per run. `pay` re-reads the bill from our database, then
  matches the portal bill on account number plus bill number (the amount is a
  check, never the key), and refuses when the portal already shows the bill
  paid or has a completed payment for it, when the amount differs, or when
  the payment page or review screen names another account, bill or amount.
- `save_receipt` records exactly what the receipt says through
  `record_payment` (DC-54), after checking it is for our account, bill and
  amount.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import SecretStr

from backend.payment_agent.playwright_portal import format_money, same_bill
from backend.payment_agent.portal import (
    PaymentForm,
    PaymentOutcome,
    PortalBillStatus,
    PortalDriver,
    PortalError,
    PortalReceipt,
)
from backend.schemas.common import PaymentMethod
from backend.schemas.payment import PaymentCreate
from backend.schemas.payment import PaymentOutcome as RecordOutcome
from backend.schemas.payment_run import (
    PaymentRunRead,
    PaymentRunReceipt,
    PaymentRunStatus,
    PaymentRunStep,
)
from backend.services.payment_repository import (
    AmountMismatch,
    BillNotApproved,
    BillNotFound,
    record_payment,
)
from backend.services.payment_run_repository import new_step, save_steps
from backend.services.vendor_account_repository import get_portal_login
from supabase import Client

logger = logging.getLogger(__name__)

OpenPortal = Callable[[str], PortalDriver]

LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")
MAX_REASON = 500
INACTIVE_ACCOUNT = "The vendor account is inactive. Nothing was paid."
# Each tool's input fields (all strings), as in prompt.TOOLS.
TOOL_INPUTS: dict[str, set[str]] = {
    "load_approved_bill": set(),
    "sign_in": set(),
    "list_portal_bills": set(),
    "pay": {"bill_number"},
    "save_receipt": set(),
    "flag_for_person": {"reason"},
}
SUBMITTED_NOTE = (
    "A payment was submitted on the portal and its result is not recorded "
    "here: check the portal before paying this bill again."
)


class RunTaken(Exception):
    """The run is no longer running (flagged elsewhere): stop touching it."""


class Redactor:
    """Removes secrets from any text the agent writes or sends."""

    def __init__(self) -> None:
        self._secrets: list[SecretStr] = []

    def add(self, secret: SecretStr) -> None:
        if secret.get_secret_value():
            self._secrets.append(secret)

    def scrub(self, text: str) -> str:
        for secret in self._secrets:
            text = text.replace(secret.get_secret_value(), "[redacted]")
        return text


class RunLog:
    """The run's steps: scrubbed, logged and saved after every step. Saving
    only succeeds while the run is running; otherwise RunTaken."""

    def __init__(
        self,
        supabase: Client,
        run: PaymentRunRead,
        redactor: Redactor,
    ) -> None:
        self._supabase = supabase
        self._run_id = run.id
        self._redactor = redactor
        self.steps: list[PaymentRunStep] = list(run.steps)

    def add(self, step: str, detail: str) -> None:
        detail = self._redactor.scrub(detail)
        self.steps.append(new_step(step, detail))
        logger.info("payment run %s: %s: %s", self._run_id, step, detail)
        if not save_steps(self._supabase, self._run_id, self.steps):
            raise RunTaken


@dataclass(frozen=True)
class Target:
    """What this run pays, from our database."""

    bill_id: UUID
    bill_number: str
    account_id: UUID
    account_number: str
    amount: Decimal
    due_date: str | None
    vendor_name: str
    portal_url: str


@dataclass(frozen=True)
class RunEnd:
    status: PaymentRunStatus
    flag_reason: str | None = None
    receipt: PaymentRunReceipt | None = None
    payment_id: UUID | None = None


@dataclass(frozen=True)
class ToolResult:
    content: dict[str, Any]
    is_error: bool = False


class Flagged(Exception):
    """Raised inside a tool to end the run as flagged."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _portal_url_ok(url: str) -> bool:
    parts = urlsplit(url)
    if parts.scheme == "https":
        return bool(parts.hostname)
    return parts.scheme == "http" and parts.hostname in LOCAL_HOSTS


@dataclass
class PaymentTools:
    supabase: Client
    run: PaymentRunRead
    open_portal: OpenPortal
    log: RunLog
    redactor: Redactor
    target: Target | None = None
    driver: PortalDriver | None = None
    signed_in: bool = False
    pay_attempts: int = 0
    payment_submitted: bool = False
    outcome: PaymentOutcome | None = None
    end: RunEnd | None = None
    _handlers: dict[str, Callable[..., dict[str, Any]]] = field(init=False)

    def __post_init__(self) -> None:
        self._handlers = {
            "load_approved_bill": self.load_approved_bill,
            "sign_in": self.sign_in,
            "list_portal_bills": self.list_portal_bills,
            "pay": self.pay,
            "save_receipt": self.save_receipt,
            "flag_for_person": self.flag_for_person,
        }

    # Dispatch

    def call(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        """Run one tool call from the model. A safety refusal ends the run;
        an out-of-order call is an error result the model can recover from."""
        if self.end is not None:
            return ToolResult({"error": "This run has ended."}, is_error=True)
        handler = self._handlers.get(name)
        if handler is None:
            return ToolResult({"error": f"Unknown tool {name}."}, is_error=True)
        if set(arguments) != TOOL_INPUTS[name] or not all(
            isinstance(value, str) for value in arguments.values()
        ):
            return ToolResult({"error": f"Bad input for {name}."}, is_error=True)
        try:
            return ToolResult(handler(**arguments))
        except Flagged as flag:
            self.flag(flag.reason)
            return ToolResult({"run_ended": "flagged", "reason": self.end_reason()})
        except _OutOfOrder as problem:
            return ToolResult({"error": str(problem)}, is_error=True)

    def end_reason(self) -> str | None:
        return self.end.flag_reason if self.end else None

    def flag(self, reason: str) -> None:
        if self.end is not None:
            return
        reason = self.redactor.scrub(reason)[:MAX_REASON]
        if self.payment_submitted and self.outcome is None:
            reason = f"{reason} {SUBMITTED_NOTE}"
        self.end = RunEnd(PaymentRunStatus.flagged, flag_reason=reason)
        self.log.add("flagged", reason)

    def close(self) -> None:
        if self.driver is not None:
            self.driver.close()
            self.driver = None

    # Preconditions

    def _target(self) -> Target:
        if self.target is None:
            raise _OutOfOrder("Call load_approved_bill first.")
        return self.target

    def _driver(self) -> PortalDriver:
        if self.driver is None or not self.signed_in:
            raise _OutOfOrder("Call sign_in first.")
        return self.driver

    def _portal(self, action: Callable[[], Any]) -> Any:
        """Run a driver call; a portal problem flags the run."""
        try:
            return action()
        except PortalError as error:
            raise Flagged(str(error)) from None

    # Database reads

    def _bill_row(self) -> dict[str, Any]:
        response = (
            self.supabase.table("bills")
            .select("bill_id,status,amount,invoice_number,due_date,vendor_account_id")
            .eq("bill_id", str(self.run.bill_id))
            .maybe_single()
            .execute()
        )
        row = response.data if response is not None else None
        if not isinstance(row, dict):
            raise Flagged("The bill no longer exists. Nothing was paid.")
        if row["status"] != "approved":
            label = str(row["status"]).replace("_", " ")
            raise Flagged(f"The bill is {label}, not approved. Nothing was paid.")
        return row

    def _row(self, table: str, key: str, value: str, columns: str) -> dict | None:
        response = (
            self.supabase.table(table)
            .select(columns)
            .eq(key, value)
            .maybe_single()
            .execute()
        )
        row = response.data if response is not None else None
        return row if isinstance(row, dict) else None

    def _active_account(self, account_id: str) -> dict[str, Any]:
        """The vendor account; an inactive (or deleted) one is never paid."""
        account = self._row(
            "vendor_accounts",
            "account_id",
            account_id,
            "account_id,account_number,portal_url,vendor_id,status",
        )
        if account is None:
            raise Flagged("The bill's vendor account no longer exists.")
        if account["status"] != "active":
            raise Flagged(INACTIVE_ACCOUNT)
        return account

    # Tools

    def load_approved_bill(self) -> dict[str, Any]:
        bill = self._bill_row()
        if bill["vendor_account_id"] is None:
            raise Flagged("The bill is not matched to a vendor account.")
        account = self._active_account(bill["vendor_account_id"])
        portal_url = (account["portal_url"] or "").strip()
        if not portal_url:
            raise Flagged("The vendor account has no portal URL.")
        if not _portal_url_ok(portal_url):
            raise Flagged(f"The portal URL {portal_url} is not https.")
        vendor = self._row(
            "vendors", "vendor_id", account["vendor_id"], "vendor_id,vendor_name"
        )

        self.target = Target(
            bill_id=self.run.bill_id,
            bill_number=bill["invoice_number"].strip(),
            account_id=UUID(account["account_id"]),
            account_number=account["account_number"].strip(),
            amount=Decimal(str(bill["amount"])).quantize(Decimal("0.01")),
            due_date=bill["due_date"],
            vendor_name=vendor["vendor_name"] if vendor else "unknown vendor",
            portal_url=portal_url,
        )
        t = self.target
        self.log.add(
            "load_approved_bill",
            f"Bill {t.bill_number} for account {t.account_number} "
            f"({t.vendor_name}): {format_money(t.amount)}, approved.",
        )
        return {
            "bill_number": t.bill_number,
            "account_number": t.account_number,
            "amount": str(t.amount),
            "due_date": t.due_date,
            "vendor": t.vendor_name,
            "portal_url": t.portal_url,
        }

    def sign_in(self) -> dict[str, Any]:
        target = self._target()
        if self.signed_in:
            return {"signed_in": True}

        login = get_portal_login(self.supabase, target.account_id)
        if login is None or not login.email or login.password is None:
            raise Flagged("The vendor account has no portal email and password.")
        self.redactor.add(login.password)

        self.driver = self._portal(lambda: self.open_portal(target.portal_url))
        driver = self.driver
        self._portal(lambda: driver.sign_in(login.email or "", login.password))
        self.signed_in = True
        self.log.add("sign_in", f"Signed in to {target.portal_url}.")
        return {"signed_in": True}

    def list_portal_bills(self) -> dict[str, Any]:
        target, driver = self._target(), self._driver()
        bills = self._portal(lambda: driver.list_bills(target.account_number))
        listed = ", ".join(
            f"{b.bill_number} {format_money(b.amount)} {b.status}" for b in bills
        )
        self.log.add(
            "list_portal_bills",
            f"Account {target.account_number} shows {len(bills)} "
            f"bill{'' if len(bills) == 1 else 's'}: {listed or 'none'}.",
        )
        return {
            "account_number": target.account_number,
            "bills": [
                {
                    "bill_number": b.bill_number,
                    "amount": str(b.amount),
                    "due_date": b.due_date,
                    "status": b.status.value,
                }
                for b in bills
            ],
        }

    def pay(self, bill_number: str) -> dict[str, Any]:
        target, driver = self._target(), self._driver()
        if self.outcome is not None:
            # The portal already took or declined it; only recording is left.
            raise _OutOfOrder("This run already paid once: call save_receipt.")
        if self.pay_attempts:
            raise Flagged("A second pay attempt was refused: one per run.")
        self.pay_attempts += 1

        ours = f"{target.bill_number} on account {target.account_number}"
        if not same_bill(bill_number, target.bill_number):
            raise Flagged(
                f"The agent asked to pay {bill_number!r}, but this run pays "
                f"{ours}. Nothing was paid."
            )

        # Our side again: still approved, same bill, same amount, and the
        # vendor account still active.
        bill = self._bill_row()
        if (
            Decimal(str(bill["amount"])) != target.amount
            or not same_bill(bill["invoice_number"], target.bill_number)
            or bill["vendor_account_id"] != str(target.account_id)
        ):
            raise Flagged("The bill changed after the run started. Nothing was paid.")
        self._active_account(str(target.account_id))

        # The portal's side: exactly one such bill, unpaid, same amount.
        bills = self._portal(lambda: driver.list_bills(target.account_number))
        matches = [b for b in bills if same_bill(b.bill_number, target.bill_number)]
        if not matches:
            raise Flagged(f"The portal does not list {ours}. Nothing was paid.")
        if len(matches) > 1:
            raise Flagged(
                f"The portal lists {ours} {len(matches)} times. Nothing was paid."
            )
        listed = matches[0]
        if listed.status is PortalBillStatus.paid:
            raise Flagged(f"The portal already shows {ours} as paid. Nothing was paid.")
        if listed.amount != target.amount:
            raise Flagged(
                f"The portal amount for {ours} is {format_money(listed.amount)}, "
                f"but the approved amount is {format_money(target.amount)}. "
                "Nothing was paid."
            )

        # Idempotency: no completed payment for this bill in the portal's
        # history (a paid bill can still read as due right after a payment).
        history = self._portal(lambda: driver.list_payments(target.account_number))
        done = [
            p
            for p in history
            if same_bill(p.bill_number, target.bill_number)
            and p.outcome is PaymentOutcome.successful
        ]
        if done:
            raise Flagged(
                f"The portal already has a completed payment for {ours} "
                f"(confirmation {done[0].confirmation_number}). Nothing was paid."
            )

        expected = PaymentForm(
            account_number=target.account_number,
            bill_number=listed.bill_number,
            amount=target.amount,
        )
        form = self._portal(
            lambda: driver.open_payment(target.account_number, listed.bill_number)
        )
        if form.account_number != target.account_number or not same_bill(
            form.bill_number, target.bill_number
        ):
            raise Flagged(
                f"The payment page opened for {form.bill_number} on account "
                f"{form.account_number}, not {ours}. Nothing was paid."
            )
        if form.amount != target.amount:
            raise Flagged(
                f"The payment page total is {format_money(form.amount)}, not "
                f"{format_money(target.amount)}. Nothing was paid."
            )

        # Saving this step also proves the run is still ours to pay.
        self.log.add(
            "pay",
            f"Paying {ours}: {format_money(target.amount)} by one-time ACH "
            "with the portal's sample details.",
        )
        self.payment_submitted = True
        self.outcome = self._portal(lambda: driver.submit_payment(expected))
        self.log.add("pay", f"The portal says the payment was {self.outcome.value}.")
        return {"outcome": self.outcome.value, "next": "Call save_receipt."}

    def save_receipt(self) -> dict[str, Any]:
        target, driver = self._target(), self._driver()
        if self.outcome is None:
            raise _OutOfOrder("Nothing was paid yet: call pay first.")
        outcome = self.outcome
        receipt: PortalReceipt = self._portal(driver.read_receipt)

        problem = None
        if receipt.account_number != target.account_number:
            problem = f"account {receipt.account_number}"
        elif not same_bill(receipt.bill_number, target.bill_number):
            problem = f"bill {receipt.bill_number}"
        elif receipt.amount != target.amount:
            problem = f"amount {format_money(receipt.amount)}"
        elif receipt.outcome is not outcome:
            problem = f"a {receipt.outcome.value} payment"
        if problem:
            raise Flagged(
                f"The receipt ({receipt.confirmation_number}) is for {problem}, "
                f"not what was paid. It is not recorded here."
            )

        today = datetime.now(UTC).date()
        paid_on = receipt.paid_on or today
        if receipt.paid_on is None:
            self.log.add("save_receipt", "Could not read the receipt date; used today.")
        record = PaymentCreate(
            amount=target.amount,
            payment_method=PaymentMethod.ACH,
            paid_on=paid_on,
            reference=receipt.confirmation_number,
            outcome=(
                RecordOutcome.COMPLETED
                if outcome is PaymentOutcome.successful
                else RecordOutcome.FAILED
            ),
            failure_reason=(
                None
                if outcome is PaymentOutcome.successful
                else "The vendor portal declined the payment."
            ),
        )
        try:
            payment = record_payment(
                self.supabase,
                bill_id=target.bill_id,
                payment=record,
                recorded_by=self.run.started_by,
            )
        except (BillNotFound, BillNotApproved, AmountMismatch) as error:
            raise Flagged(
                f"The portal says the payment was {outcome.value} (confirmation "
                f"{receipt.confirmation_number}), but recording it here was "
                f"refused ({type(error).__name__}). A person must reconcile it."
            ) from None

        saved = PaymentRunReceipt(
            confirmation_number=receipt.confirmation_number,
            bill_number=receipt.bill_number,
            amount=receipt.amount,
            paid_on=paid_on,
            outcome=outcome.value,
            portal=target.portal_url,
        )
        status = (
            PaymentRunStatus.paid
            if outcome is PaymentOutcome.successful
            else PaymentRunStatus.failed
        )
        what = "payment" if status is PaymentRunStatus.paid else "declined attempt"
        self.log.add(
            "save_receipt",
            f"Recorded the {what}: confirmation {saved.confirmation_number}, "
            f"{format_money(saved.amount)}, {saved.paid_on.isoformat()}.",
        )
        self.end = RunEnd(status, receipt=saved, payment_id=payment.id)
        return {"recorded": True, "confirmation_number": saved.confirmation_number}

    def flag_for_person(self, reason: str) -> dict[str, Any]:
        if self.outcome is not None:
            # A payment the portal answered is recorded, whatever comes next.
            raise _OutOfOrder(
                "The portal already answered the payment: call save_receipt."
            )
        raise Flagged(f"The agent flagged this run: {reason.strip() or 'no reason'}")


class _OutOfOrder(Exception):
    """A tool was called before the one it needs; the model can fix it."""


def tool_result_block(tool_use_id: str, result: ToolResult, redactor: Redactor):
    return {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": redactor.scrub(json.dumps(result.content)),
        "is_error": result.is_error,
    }

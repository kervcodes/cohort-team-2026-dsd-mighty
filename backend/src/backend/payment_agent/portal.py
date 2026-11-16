"""What the payment agent needs from a vendor payment portal.

`PortalDriver` is the seam between the agent's checks and the browser: the
agent only ever sees these types, so the Playwright driver
(`playwright_portal.py`) can be swapped for another browser layer or a
portal's API later. A driver reports what the portal shows; it never decides
whether paying is safe - `tools.py` does.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Protocol

from pydantic import SecretStr


class PortalBillStatus(StrEnum):
    due = "due"
    overdue = "overdue"
    paid = "paid"


class PaymentOutcome(StrEnum):
    successful = "successful"
    declined = "declined"


@dataclass(frozen=True)
class PortalBill:
    """One row of the account's bill list."""

    bill_number: str
    amount: Decimal
    due_date: str  # as the portal prints it
    status: PortalBillStatus


@dataclass(frozen=True)
class PortalPayment:
    """One row of the account's payment history."""

    confirmation_number: str
    bill_number: str
    amount: Decimal
    outcome: PaymentOutcome


@dataclass(frozen=True)
class PaymentForm:
    """What the open payment page says it is about to pay."""

    account_number: str
    bill_number: str
    amount: Decimal


@dataclass(frozen=True)
class PortalReceipt:
    account_number: str
    confirmation_number: str
    bill_number: str
    amount: Decimal
    outcome: PaymentOutcome
    paid_on: date | None  # None when the portal's date could not be read


class PortalError(Exception):
    """The portal did not do what was expected. The message is written for a
    person reading the run's steps and never carries a secret."""


class PortalTimeout(PortalError):
    """The portal did not answer in time."""


class SignInFailed(PortalError):
    """The portal refused the login."""


class AccountNotOnPortal(PortalError):
    """The login has no service account with our account number."""


class PaymentNotSubmitted(PortalError):
    """`submit_payment` stopped before pressing the final Submit / Pay button,
    so nothing reached the portal's payment step. Any other error from
    `submit_payment` means the payment may have been submitted."""


class PortalDriver(Protocol):
    def sign_in(self, email: str, password: SecretStr) -> None:
        """Sign in. Raises SignInFailed, PortalTimeout or PortalError."""
        ...

    def list_bills(self, account_number: str) -> list[PortalBill]:
        """The bills of `account_number` only. Raises AccountNotOnPortal."""
        ...

    def list_payments(self, account_number: str) -> list[PortalPayment]:
        """The payment history of `account_number` only."""
        ...

    def open_payment(self, account_number: str, bill_number: str) -> PaymentForm:
        """Open the payment page of the bill and read what it will pay."""
        ...

    def submit_payment(self, expected: PaymentForm) -> PaymentOutcome:
        """Fill the sample details, authorize and submit the open payment,
        confirming on a review screen if the portal has one. Refuses if the
        payment page, Pay button or review screen names a different bill or
        amount than `expected`.

        Raises PaymentNotSubmitted for a refusal or failure before the final
        Submit / Pay click, and only then: any other error (including one
        from the click itself) may come after the portal took the payment."""
        ...

    def read_receipt(self) -> PortalReceipt:
        """Read the receipt the portal showed after submitting."""
        ...

    def close(self) -> None: ...

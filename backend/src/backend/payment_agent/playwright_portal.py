"""`PortalDriver` for the DSD demo utility portals, with Playwright (headless
Chromium).

The ten demo portals (https://<company>-utility-demo.vercel.app) run the same
hash-routed app (`app.js` + `journeys.js`) with a per-company `company.js`.
What differs, and how this driver handles it:

- `billing`: "direct" lists "Pay bill <BILL>" links; "statement" lists
  "View statement <BILL>" links whose page has "Pay this statement"; "center"
  lands on `#billing` after sign-in. The driver always works from `#account`.
- `review`: false shows a "Pay $<amount>" button; true shows "Review payment",
  then a "Review your payment" screen whose button is "Submit payment".
- Wording ("Your bills" / "Your statements", "Service address" / "Billing
  address") is never relied on.

One login holds several service accounts; the page shows the one picked in
"Property / service account", whose option text ends in its account number.
The app switches that selection by itself when a `#pay/<bill>` or
`#receipt/<id>` route names another account's bill, so every page this driver
reads is checked against the selected account number.

Selectors are labels, roles and button text from the bundle, plus a few
structural reads (table headers, `dl` pairs) done in one `evaluate`.

Errors: every public method converts Playwright errors into `PortalError` /
`PortalTimeout` with a message written here, raised outside the `except`
block so no Playwright message (which could quote a typed value) rides along
as the exception's context.
"""

import re
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, TypeVar

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Locator, Page, Playwright, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from pydantic import SecretStr

from backend.payment_agent.portal import (
    AccountNotOnPortal,
    PaymentForm,
    PaymentOutcome,
    PortalBill,
    PortalBillStatus,
    PortalError,
    PortalPayment,
    PortalReceipt,
    PortalTimeout,
    SignInFailed,
)

T = TypeVar("T")

ACCOUNT_SELECTOR = "Property / service account"
PAY_BUTTON = re.compile(r"^(Pay \$[\d,]+\.\d{2}|Review payment)$")
OVERVIEW_HEADING = re.compile(r"^Welcome, ")
RESULT_HEADING = re.compile(r"^Payment (complete|declined)\.$")
OPEN_BILL_LINK = ("Pay bill", "View statement")

BILL_STATUSES = {
    "due": PortalBillStatus.due,
    "overdue": PortalBillStatus.overdue,
    "paid": PortalBillStatus.paid,
}
PAYMENT_STATUSES = {
    "completed": PaymentOutcome.successful,
    "successful": PaymentOutcome.successful,
    "declined": PaymentOutcome.declined,
}

# Reads a table into [{header: {text, small}}], keyed by lower-case header
# text, so a column move does not break it. `small` is the second line of a
# cell (the bill number under a description, the bill under a payment id).
READ_TABLE = """
table => {
  const heads = [...table.querySelectorAll('thead th')]
    .map(th => th.textContent.trim().toLowerCase());
  return [...table.querySelectorAll('tbody tr')].map(row => {
    const cells = [...row.querySelectorAll('td')];
    const out = {};
    heads.forEach((head, i) => {
      const cell = cells[i];
      out[head] = {
        text: cell ? cell.textContent.trim() : '',
        small: cell?.querySelector('.small')?.textContent.trim() ?? null,
      };
    });
    return out;
  });
}
"""

# Every <dt>label</dt><dd>value</dd> pair under `root`, plus the
# "Total payment" line of the bill summary.
READ_FIELDS = """
root => {
  const out = {};
  root.querySelectorAll('dt').forEach(dt => {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') out[dt.textContent.trim()] = dd.textContent.trim();
  });
  root.querySelectorAll('.total-line').forEach(line => {
    const label = line.querySelector('span')?.textContent.trim();
    const value = line.querySelector('strong')?.textContent.trim();
    if (label && value) out[label] = value;
  });
  return out;
}
"""

SELECTED_ACCOUNT = "s => s.options[s.selectedIndex]?.textContent ?? ''"
ACCOUNT_OPTIONS = (
    "s => [...s.options].map(o => ({value: o.value, text: o.textContent}))"
)


def parse_money(text: str) -> Decimal:
    """'$1,234.56' -> Decimal('1234.56')."""
    cleaned = text.strip().removeprefix("$").replace(",", "")
    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        raise PortalError(f"Could not read the amount {text!r}.") from None
    if not amount.is_finite() or amount.as_tuple().exponent != -2:
        raise PortalError(f"Could not read the amount {text!r}.")
    return amount


def format_money(amount: Decimal) -> str:
    return f"${amount:,.2f}"


def account_number_of(option_text: str) -> str:
    """'Elm Court · Whole property · Acme · 2000456700' -> '2000456700'."""
    return option_text.rsplit("·", 1)[-1].strip()


def _parse_date(text: str) -> date | None:
    try:
        return datetime.strptime(text.strip(), "%b %d, %Y").date()
    except ValueError:
        return None


def same_bill(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


class PlaywrightPortal:
    """A headless Chromium session on one portal. Not thread-safe; one per
    run. Close it (or use it as a context manager) to stop the browser."""

    def __init__(self, portal_url: str, *, timeout_ms: int = 15_000) -> None:
        self._base_url = portal_url.split("#", 1)[0]
        self._timeout_ms = timeout_ms
        self._playwright: Playwright | None = None
        failure: PortalError | None = None
        try:
            self._playwright = sync_playwright().start()
            browser = self._playwright.chromium.launch(headless=True)
            self._page: Page = browser.new_context().new_page()
            self._page.set_default_timeout(timeout_ms)
        except PlaywrightError:
            failure = PortalError(
                "Could not start the browser. Is Chromium installed "
                "(uv run playwright install chromium)?"
            )
        if failure is not None:
            self.close()
            raise failure

    def __enter__(self) -> "PlaywrightPortal":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._playwright is not None:
            try:
                self._playwright.stop()  # also closes the browser
            except PlaywrightError:
                pass
            self._playwright = None

    # Error handling

    def _attempt(self, doing: str, action: Callable[[], T]) -> T:
        failure: PortalError
        try:
            return action()
        except PortalError:
            raise
        except PlaywrightTimeoutError:
            failure = PortalTimeout(f"Timed out waiting for the portal while {doing}.")
        except Exception:
            # Any other Playwright (or unexpected) error: the message is ours
            # alone, so nothing typed into the page can leak through it.
            failure = PortalError(
                f"The portal did not behave as expected while {doing}."
            )
        raise failure

    # Navigation and reading

    def _go(self, route: str) -> None:
        self._page.evaluate("route => { location.hash = route; }", route)

    def _heading(self, name: str | re.Pattern[str]) -> Locator:
        return self._page.get_by_role("heading", name=name)

    def _error_notice(self) -> Locator:
        return self._page.locator("[role=status].error")

    def _account_select(self) -> Locator:
        return self._page.get_by_label(ACCOUNT_SELECTOR)

    def _selected_account(self) -> str:
        return account_number_of(self._account_select().evaluate(SELECTED_ACCOUNT))

    def _require_account(self, account_number: str, where: str) -> None:
        shown = self._selected_account()
        if shown != account_number:
            raise PortalError(
                f"The {where} is for account {shown or 'unknown'}, "
                f"not {account_number}."
            )

    def _fields(self, root: Locator) -> dict[str, str]:
        return root.evaluate(READ_FIELDS)

    def _select_account(self, account_number: str) -> None:
        select = self._account_select()
        options: list[dict[str, str]] = select.evaluate(ACCOUNT_OPTIONS)
        matches = [o for o in options if account_number_of(o["text"]) == account_number]
        if not matches:
            raise AccountNotOnPortal(
                f"This portal login has no service account {account_number}."
            )
        if len(matches) > 1:
            raise PortalError(
                f"This portal login lists account {account_number} "
                f"{len(matches)} times."
            )
        if select.input_value() != matches[0]["value"]:
            select.select_option(matches[0]["value"])
        self._go("account")
        # The overview's heading, so a table still showing from the page
        # before the route change is never read.
        self._heading(OVERVIEW_HEADING).wait_for()
        self._require_account(account_number, "account page")

    def _read_table(self) -> list[dict[str, dict[str, Any]]]:
        return self._page.get_by_role("table").evaluate(READ_TABLE)

    # PortalDriver

    def sign_in(self, email: str, password: SecretStr) -> None:
        self._attempt("signing in", lambda: self._sign_in(email, password))

    def _sign_in(self, email: str, password: SecretStr) -> None:
        page = self._page
        page.goto(f"{self._base_url}#signin/account", wait_until="domcontentloaded")
        page.get_by_label("Email address").fill(email)
        page.get_by_label("Password").fill(password.get_secret_value())
        page.get_by_role("button", name="Sign in", exact=True).click()

        signed_in = page.get_by_role("button", name="Sign out")
        signed_in.or_(self._error_notice()).first.wait_for()
        if not signed_in.is_visible():
            # The portal's own message, e.g. "Invalid email or password."
            message = self._error_notice().first.inner_text().strip()[:200]
            raise SignInFailed(f"The portal refused the login: {message}")

    def list_bills(self, account_number: str) -> list[PortalBill]:
        return self._attempt(
            "reading the account's bills", lambda: self._list_bills(account_number)
        )

    def _list_bills(self, account_number: str) -> list[PortalBill]:
        self._select_account(account_number)
        bills = []
        for row in self._read_table():
            bill_cell, status = row.get("bill"), row.get("status", {}).get("text")
            bill_number = bill_cell and bill_cell.get("small")
            if not bill_number or status is None:
                raise PortalError("The bill list does not look as expected.")
            if status.casefold() not in BILL_STATUSES:
                raise PortalError(f"Unknown bill status {status!r} on the portal.")
            bills.append(
                PortalBill(
                    bill_number=bill_number,
                    amount=parse_money(row["amount"]["text"]),
                    due_date=row["due date"]["text"],
                    status=BILL_STATUSES[status.casefold()],
                )
            )
        return bills

    def list_payments(self, account_number: str) -> list[PortalPayment]:
        return self._attempt(
            "reading the payment history", lambda: self._list_payments(account_number)
        )

    def _list_payments(self, account_number: str) -> list[PortalPayment]:
        self._select_account(account_number)
        self._go("history")
        self._heading("Payment history").wait_for()
        self._require_account(account_number, "payment history")
        if self._page.get_by_role("table").count() == 0:
            return []  # "No payments yet."
        payments = []
        for row in self._read_table():
            status = row["status"]["text"].casefold()
            if status not in PAYMENT_STATUSES:
                raise PortalError(f"Unknown payment status {status!r} on the portal.")
            cell = row["payment"]
            bill_number = cell["small"] or ""
            payments.append(
                PortalPayment(
                    # The cell is the payment id with the bill number under it.
                    confirmation_number=cell["text"].removesuffix(bill_number).strip(),
                    bill_number=bill_number,
                    amount=parse_money(row["amount"]["text"]),
                    outcome=PAYMENT_STATUSES[status],
                )
            )
        return payments

    def open_payment(self, account_number: str, bill_number: str) -> PaymentForm:
        return self._attempt(
            "opening the payment page",
            lambda: self._open_payment(account_number, bill_number),
        )

    def _open_payment(self, account_number: str, bill_number: str) -> PaymentForm:
        page = self._page
        self._select_account(account_number)

        links = [
            page.get_by_role("link", name=f"{label} {bill_number}", exact=True)
            for label in OPEN_BILL_LINK
        ]
        found = [link for link in links if link.count() > 0]
        if len(found) != 1 or found[0].count() != 1:
            raise PortalError(f"Could not find one open bill {bill_number} to pay.")
        found[0].click()

        statement = self._heading("Your billing statement")
        paying = self._heading("Make a payment")
        unavailable = self._heading("Bill unavailable")
        statement.or_(paying).or_(unavailable).first.wait_for()
        if statement.is_visible():
            fields = self._fields(page.locator("section.statement"))
            if not same_bill(fields.get("Statement number", ""), bill_number):
                raise PortalError(
                    f"The statement opened is {fields.get('Statement number')!r}, "
                    f"not {bill_number}."
                )
            self._require_account(account_number, "statement")
            page.get_by_role("link", name="Pay this statement").click()
            paying.or_(unavailable).first.wait_for()
        if unavailable.is_visible():
            raise PortalError(
                f"The portal says bill {bill_number} is already paid or gone."
            )
        return self._read_payment_form()

    def _read_payment_form(self) -> PaymentForm:
        self._heading("Make a payment").wait_for()
        summary = self._fields(self._page.locator("section.bill-summary"))
        if "Bill number" not in summary or "Total payment" not in summary:
            raise PortalError("The payment page's bill summary is missing.")
        return PaymentForm(
            account_number=self._selected_account(),
            bill_number=summary["Bill number"],
            amount=parse_money(summary["Total payment"]),
        )

    def submit_payment(self, expected: PaymentForm) -> PaymentOutcome:
        return self._attempt(
            "submitting the payment", lambda: self._submit_payment(expected)
        )

    def _submit_payment(self, expected: PaymentForm) -> PaymentOutcome:
        page = self._page
        if self._read_payment_form() != expected:
            raise PortalError("The payment page changed before paying.")

        form = page.locator("form#payment-form")
        form.get_by_label("Payment method").select_option("bank")
        form.get_by_role("button", name="Use sample details").click()
        form.get_by_role(
            "checkbox", name=re.compile(r"^I authorize this simulated")
        ).check()
        scenario = form.get_by_label("Simulated result")
        if scenario.count() > 0:
            scenario.select_option("success")

        button = form.get_by_role("button", name=PAY_BUTTON)
        if button.count() != 1:
            raise PortalError("Could not find the Pay or Review payment button.")
        label = button.inner_text().strip()
        if label != "Review payment":
            shown = parse_money(label.removeprefix("Pay "))
            if shown != expected.amount:
                raise PortalError(
                    f"The Pay button says {format_money(shown)}, "
                    f"not {format_money(expected.amount)}."
                )
            button.click()
        else:
            button.click()
            review = page.locator("#payment-review")
            review.get_by_role("heading", name="Review your payment").wait_for()
            text = " ".join(review.inner_text().split())
            wanted = f"{format_money(expected.amount)} for {expected.bill_number}"
            if wanted not in text:
                raise PortalError(
                    f"The review screen does not say {wanted}; nothing was paid."
                )
            review.get_by_role("button", name="Submit payment").click()

        result = self._heading(RESULT_HEADING)
        result.or_(self._error_notice()).first.wait_for()
        if not result.is_visible():
            message = self._error_notice().first.inner_text().strip()[:200]
            raise PortalError(
                f"The portal showed an error after the payment was submitted: {message}"
            )
        heading = result.inner_text().strip()
        return (
            PaymentOutcome.successful
            if heading == "Payment complete."
            else PaymentOutcome.declined
        )

    def read_receipt(self) -> PortalReceipt:
        return self._attempt("reading the receipt", self._read_receipt)

    def _read_receipt(self) -> PortalReceipt:
        heading = self._heading(RESULT_HEADING)
        heading.wait_for()
        fields = self._fields(self._page.locator("section.receipt"))
        needed = ("Confirmation number", "Bill number", "Amount", "Status", "Date")
        missing = [name for name in needed if name not in fields]
        if missing:
            raise PortalError(f"The receipt is missing {', '.join(missing)}.")
        status = fields["Status"].casefold()
        if status not in PAYMENT_STATUSES:
            raise PortalError(f"Unknown receipt status {fields['Status']!r}.")
        outcome = PAYMENT_STATUSES[status]
        headline = heading.inner_text().strip()
        if (outcome is PaymentOutcome.successful) != (headline == "Payment complete."):
            raise PortalError("The receipt's heading and status disagree.")
        return PortalReceipt(
            account_number=self._selected_account(),
            confirmation_number=fields["Confirmation number"],
            bill_number=fields["Bill number"],
            amount=parse_money(fields["Amount"]),
            outcome=outcome,
            paid_on=_parse_date(fields["Date"]),
        )

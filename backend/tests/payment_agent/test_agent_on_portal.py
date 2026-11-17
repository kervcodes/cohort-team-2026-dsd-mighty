"""The payment agent end to end: the real agent loop, tools and Playwright
driver (headless Chromium) against a local fake portal (fake_portal.py), with
a scripted model (fake_model.py) and FakeSupabase. Nothing leaves the
machine. Needs Chromium: `uv run playwright install chromium` (CI installs it).

`portal.payment_posts` is what reached the portal's payment endpoint, so
"nothing was paid" is checked where it matters.
"""

import logging
from decimal import Decimal

import pytest
from agent_setup import (
    AMOUNT,
    APPROVER,
    AWKWARD_PASSWORDS,
    BILL_NUMBER,
    Setup,
    agent,
    assert_password_never_shown,
    make_setup,
)
from fake_model import HAPPY_PATH, tool
from fake_portal import EMAIL, OUR_ACCOUNT, PASSWORD, Account, FakePortal
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright
from pydantic import SecretStr

from backend.payment_agent.model import AgentConfig
from backend.payment_agent.playwright_portal import PlaywrightPortal
from backend.payment_agent.portal import PaymentForm, PaymentNotSubmitted
from backend.schemas.payment_run import PaymentRunStatus

CENTS = 18642
OTHER_ACCOUNT = "2000456799"


@pytest.fixture(autouse=True, scope="module")
def chromium() -> None:
    """Fail (never skip) with the fix when Chromium is missing, so CI cannot
    pass without running these tests."""
    try:
        with sync_playwright() as playwright:
            playwright.chromium.launch(headless=True).close()
    except PlaywrightError:
        pytest.fail(
            "Chromium for Playwright is missing: run "
            "`uv run playwright install chromium` in backend/."
        )


def portal_with_our_bill(**options) -> FakePortal:
    """Our account plus another property's account behind the same login,
    both with a bill for the same amount."""
    portal = FakePortal(
        accounts=[Account(OTHER_ACCOUNT, name="Other Property"), Account(OUR_ACCOUNT)],
        **options,
    )
    portal.add_bill(OTHER_ACCOUNT, "BILL-2001", CENTS)
    portal.add_bill(OUR_ACCOUNT, BILL_NUMBER, CENTS)
    return portal


def run(portal: FakePortal, script=HAPPY_PATH, **kwargs):
    setup = make_setup(portal.url, **kwargs.pop("setup", {}))
    status, model = agent(setup, script, open_portal=None, **kwargs)
    return setup, status, model


def assert_flagged(setup: Setup, status, portal: FakePortal, *words: str) -> None:
    """Flagged with nothing paid: no payment reached the portal, and the
    reason never says one might have."""
    assert status is PaymentRunStatus.flagged
    run = setup.run
    assert run["status"] == "flagged"
    for word in words:
        assert word in run["flag_reason"], run["flag_reason"]
    assert "check the portal" not in run["flag_reason"], run["flag_reason"]
    assert run["payment_id"] is None and run["finished_at"]
    assert setup.payments() == []
    assert setup.bill["status"] == "approved"
    assert portal.payment_posts == []


def assert_flagged_to_check_the_portal(
    setup: Setup, status, portal: FakePortal, *words: str
) -> None:
    """Flagged after the payment may have reached the portal: nothing is
    recorded here, and the reason says to check the portal, never that
    nothing was paid."""
    assert status is PaymentRunStatus.flagged
    run = setup.run
    for word in words:
        assert word in run["flag_reason"], run["flag_reason"]
    assert "check the portal before paying this bill again" in run["flag_reason"]
    assert "Nothing was paid" not in run["flag_reason"]
    assert run["payment_id"] is None and run["finished_at"]
    assert setup.payments() == []
    assert setup.bill["status"] == "approved"


# Paying


@pytest.mark.parametrize(
    ("billing", "review"),
    [
        ("direct", False),  # "Pay bill", then "Pay $186.42"
        ("statement", True),  # "View statement", "Pay this statement", review
        ("center", True),  # lands on #billing after sign-in, review
        ("statement", False),
    ],
)
def test_pays_the_bill_and_records_the_receipt(billing, review):
    with portal_with_our_bill(billing=billing, review=review) as portal:
        setup, status, _model = run(portal)

    assert status is PaymentRunStatus.paid
    [post] = portal.payment_posts
    assert post["billId"] == BILL_NUMBER
    assert post["serviceAccountId"] == portal.account(OUR_ACCOUNT).id
    assert post["method"] == "bank" and post["scenario"] == "success"
    assert post["details"]["authorized"] is True

    [receipt] = [p for p in portal.payments if p["billId"] == BILL_NUMBER]
    [payment] = setup.payments()
    assert payment["payment_status"] == "completed"
    assert payment["provider_reference"] == receipt["id"]
    assert payment["recorded_by"] == APPROVER
    assert Decimal(payment["amount"]) == Decimal(AMOUNT)
    assert payment["payment_method"] == "ach"
    assert setup.bill["status"] == "paid"

    run_row = setup.run
    assert run_row["status"] == "paid"
    assert run_row["payment_id"] == payment["payment_id"]
    assert run_row["flag_reason"] is None
    assert run_row["receipt"]["confirmation_number"] == receipt["id"]
    assert run_row["receipt"]["amount"] == AMOUNT
    assert run_row["receipt"]["outcome"] == "successful"
    assert run_row["receipt"]["portal"] == portal.url
    steps = [step["step"] for step in run_row["steps"]]
    assert steps == [
        "claimed",
        "started",
        "load_approved_bill",
        "sign_in",
        "list_portal_bills",
        "pay",
        "pay",
        "receipt",
        "finished",
    ]


def test_duplicate_amounts_pay_only_our_bill_number():
    # Our account has two unpaid bills for the same amount, and another
    # property's account has one too: only BILL-1001 on our account is paid.
    with portal_with_our_bill() as portal:
        portal.add_bill(OUR_ACCOUNT, "BILL-1002", CENTS)
        setup, status, _model = run(portal)

    assert status is PaymentRunStatus.paid
    [post] = portal.payment_posts
    assert (post["billId"], post["serviceAccountId"]) == (
        BILL_NUMBER,
        portal.account(OUR_ACCOUNT).id,
    )
    paid = [b["id"] for b in portal.bills if b["status"] == "paid"]
    assert paid == [BILL_NUMBER]


def test_the_model_cannot_pay_a_same_amount_bill_with_another_number():
    with portal_with_our_bill() as portal:
        portal.add_bill(OUR_ACCOUNT, "BILL-1002", CENTS)
        script = [*HAPPY_PATH[:3], tool("pay", bill_number="BILL-1002")]
        setup, status, _model = run(portal, script)

    assert_flagged(setup, status, portal, "BILL-1002", BILL_NUMBER)


def test_declined_payment_is_recorded_as_failed():
    with portal_with_our_bill(decline=True, review=True) as portal:
        setup, status, _model = run(portal)

    assert status is PaymentRunStatus.failed
    assert len(portal.payment_posts) == 1
    [payment] = setup.payments()
    assert payment["payment_status"] == "failed"
    assert payment["failure_reason"] == "The vendor portal declined the payment."
    assert setup.bill["status"] == "approved"
    run_row = setup.run
    assert run_row["status"] == "failed"
    assert run_row["payment_id"] == payment["payment_id"]
    assert run_row["receipt"]["outcome"] == "declined"


# Refusing to pay


def test_wrong_amount_on_the_portal_is_flagged():
    with FakePortal(accounts=[Account(OUR_ACCOUNT)]) as portal:
        portal.add_bill(OUR_ACCOUNT, BILL_NUMBER, 19000)
        setup, status, _model = run(portal)

    assert_flagged(setup, status, portal, "$190.00", "$186.42", "Nothing was paid")


def test_bill_not_on_the_portal_is_flagged():
    with FakePortal(accounts=[Account(OUR_ACCOUNT)]) as portal:
        portal.add_bill(OUR_ACCOUNT, "BILL-0999", CENTS)
        setup, status, _model = run(portal)

    assert_flagged(setup, status, portal, "does not list", BILL_NUMBER)


def test_bill_already_paid_on_the_portal_is_flagged():
    with FakePortal(accounts=[Account(OUR_ACCOUNT)]) as portal:
        portal.add_bill(OUR_ACCOUNT, BILL_NUMBER, CENTS, status="paid")
        portal.add_bill(OUR_ACCOUNT, "BILL-1002", CENTS)  # never pay another
        setup, status, _model = run(portal)

    assert_flagged(setup, status, portal, "already shows", "as paid")


def test_completed_payment_in_history_is_flagged_even_if_listed_due():
    with FakePortal(accounts=[Account(OUR_ACCOUNT)]) as portal:
        portal.add_bill(OUR_ACCOUNT, BILL_NUMBER, CENTS)
        earlier = portal.add_payment(OUR_ACCOUNT, BILL_NUMBER, CENTS)
        setup, status, _model = run(portal)

    assert_flagged(setup, status, portal, "completed payment", earlier["id"])


def test_declined_payment_in_history_does_not_block_paying():
    with portal_with_our_bill() as portal:
        portal.add_payment(OUR_ACCOUNT, BILL_NUMBER, CENTS, status="declined")
        _setup, status, _model = run(portal)

    assert status is PaymentRunStatus.paid
    assert len(portal.payment_posts) == 1


def test_account_not_behind_the_login_is_flagged():
    with FakePortal(accounts=[Account(OTHER_ACCOUNT)]) as portal:
        portal.add_bill(OTHER_ACCOUNT, BILL_NUMBER, CENTS)  # same bill number
        setup, status, _model = run(portal)

    assert_flagged(setup, status, portal, OUR_ACCOUNT)


def test_bill_number_on_another_account_switching_the_page_is_flagged():
    # The portal opens #pay/<bill> on the first account that has that bill
    # number, so the payment page shows the other property's bill.
    with FakePortal(
        accounts=[Account(OTHER_ACCOUNT, name="Other Property"), Account(OUR_ACCOUNT)]
    ) as portal:
        portal.add_bill(OTHER_ACCOUNT, BILL_NUMBER, CENTS)
        portal.add_bill(OUR_ACCOUNT, BILL_NUMBER, CENTS)
        setup, status, _model = run(portal)

    assert_flagged(setup, status, portal, OTHER_ACCOUNT)


def test_pay_button_for_another_amount_is_not_pressed():
    extra = {"payButtonCents": 19999}
    with portal_with_our_bill(company_extra=extra) as portal:
        setup, status, _model = run(portal)

    assert_flagged(
        setup,
        status,
        portal,
        "The Pay button says $199.99, not $186.42. Nothing was paid.",
    )


def test_missing_pay_button_is_flagged_with_nothing_paid():
    extra = {"payButtonLabel": "Continue"}
    with portal_with_our_bill(company_extra=extra) as portal:
        setup, status, _model = run(portal)

    assert_flagged(
        setup,
        status,
        portal,
        "Could not find the Pay or Review payment button. Nothing was paid.",
    )


def test_review_screen_for_another_amount_is_not_confirmed():
    extra = {"reviewCents": 19999}
    with portal_with_our_bill(review=True, company_extra=extra) as portal:
        setup, status, _model = run(portal)

    assert_flagged_to_check_the_portal(
        setup,
        status,
        portal,
        f"The review screen does not say $186.42 for {BILL_NUMBER}.",
    )
    assert portal.payment_posts == []  # Submit payment was never pressed


def test_review_screen_for_a_longer_bill_number_is_not_confirmed():
    extra = {"reviewBillId": f"{BILL_NUMBER}0"}
    with portal_with_our_bill(review=True, company_extra=extra) as portal:
        setup, status, _model = run(portal)

    assert_flagged_to_check_the_portal(
        setup,
        status,
        portal,
        f"The review screen does not say $186.42 for {BILL_NUMBER}.",
    )
    assert portal.payment_posts == []  # Submit payment was never pressed


def test_review_screen_without_a_submit_button_times_out_to_check_the_portal():
    extra = {"submitButtonLabel": "Continue"}
    with portal_with_our_bill(review=True, company_extra=extra) as portal:
        setup, status, _model = run(portal, config=AgentConfig(portal_timeout_ms=1_500))

    assert_flagged_to_check_the_portal(
        setup,
        status,
        portal,
        "Timed out waiting for the portal while submitting the payment.",
    )
    assert portal.payment_posts == []


def test_driver_refuses_a_payment_page_that_changed_before_paying():
    # The agent re-checks the page before submit_payment, so this check only
    # fires on a page that changes in between: drive the driver directly.
    other_amount = PaymentForm(OUR_ACCOUNT, BILL_NUMBER, Decimal("186.43"))
    with portal_with_our_bill() as portal, PlaywrightPortal(portal.url) as driver:
        driver.sign_in(EMAIL, SecretStr(PASSWORD))
        driver.open_payment(OUR_ACCOUNT, BILL_NUMBER)
        with pytest.raises(PaymentNotSubmitted, match="changed before paying"):
            driver.submit_payment(other_amount)

    assert portal.payment_posts == []


# Failures


def test_login_failure_is_flagged():
    with portal_with_our_bill() as portal:
        setup, status, _model = run(portal, setup={"password": "not-the-password"})

    assert_flagged(setup, status, portal, "refused the login")
    assert portal.login_attempts == 1


def test_portal_that_never_answers_times_out_before_paying():
    with portal_with_our_bill(hang={"/api/account"}) as portal:
        setup, status, _model = run(portal, config=AgentConfig(portal_timeout_ms=1_500))

    assert_flagged(setup, status, portal, "Timed out")


def test_no_answer_after_submitting_is_flagged_to_check_the_portal():
    with portal_with_our_bill(hang={"/api/payments"}) as portal:
        setup, status, _model = run(portal, config=AgentConfig(portal_timeout_ms=1_500))

    assert_flagged_to_check_the_portal(
        setup, status, portal, "Timed out", "while submitting the payment"
    )


# The password


@pytest.mark.parametrize(
    "case",
    ["paid", "login refused", "timeout", "declined"],
)
def test_password_never_leaves_vault_and_the_browser(case, caplog):
    caplog.set_level(logging.DEBUG)
    options = {
        "paid": {},
        "login refused": {},
        "timeout": {"hang": {"/api/payments"}},
        "declined": {"decline": True},
    }[case]
    # A login the portal refuses still sends the stored password to it.
    stored = PASSWORD if case != "login refused" else "Wrong-Pw-9xQ!stored"
    with portal_with_our_bill(**options) as portal:
        setup, _status, model = run(
            portal,
            setup={"password": stored},
            config=AgentConfig(portal_timeout_ms=1_500),
        )

    run_row = setup.run
    seen = [
        model.sent(),
        caplog.text,
        str(run_row["steps"]),
        str(run_row["flag_reason"]),
        str(run_row["receipt"]),
        str(setup.payments()),
    ]
    for text in seen:
        assert stored not in text


# Regressions


@pytest.mark.parametrize(
    ("decline", "ended"),
    [(False, PaymentRunStatus.paid), (True, PaymentRunStatus.failed)],
)
def test_a_tool_that_navigates_after_pay_cannot_lose_the_receipt(decline, ended):
    # list_portal_bills leaves the receipt page; pay has recorded it already.
    script = [*HAPPY_PATH[:4], tool("list_portal_bills")]
    with portal_with_our_bill(decline=decline) as portal:
        setup, status, model = run(
            portal, script, config=AgentConfig(portal_timeout_ms=1_500)
        )

    assert status is ended
    assert len(model.requests) == 4  # nothing ran after pay
    assert len(portal.payment_posts) == 1
    [on_portal] = portal.payments
    [payment] = setup.payments()
    assert payment["provider_reference"] == on_portal["id"]
    assert payment["payment_status"] == ("failed" if decline else "completed")
    assert setup.run["payment_id"] == payment["payment_id"]
    assert setup.run["receipt"]["confirmation_number"] == on_portal["id"]


def test_a_failure_from_the_review_payment_click_on_says_to_check_the_portal():
    # The Review payment click may itself pay on a real portal, so a failure
    # after it (here, no review screen appears) is never "Nothing was paid".
    extra = {"reviewHeading": "Confirm your payment"}
    with portal_with_our_bill(review=True, company_extra=extra) as portal:
        setup, status, _model = run(portal, config=AgentConfig(portal_timeout_ms=1_500))

    assert_flagged_to_check_the_portal(
        setup,
        status,
        portal,
        "Timed out waiting for the portal while submitting the payment.",
    )
    assert portal.payment_posts == []


@pytest.mark.parametrize("password", AWKWARD_PASSWORDS)
@pytest.mark.parametrize("case", ["paid", "timeout", "declined"])
def test_an_awkward_password_never_leaves_vault_and_the_browser(password, case, caplog):
    caplog.set_level(logging.DEBUG)
    options, ended = {
        "paid": ({}, PaymentRunStatus.paid),
        "timeout": ({"hang": {"/api/payments"}}, PaymentRunStatus.flagged),
        "declined": ({"decline": True}, PaymentRunStatus.failed),
    }[case]
    with portal_with_our_bill(password=password, **options) as portal:
        setup, status, model = run(
            portal,
            setup={"password": password},
            config=AgentConfig(portal_timeout_ms=1_500),
        )

    assert portal.login_attempts == 1
    assert status is ended  # the portal took the login
    assert_password_never_shown(password, setup, model, caplog.text)

"""The agent's limits and checks that need no browser: run with a stub portal
driver and a scripted model, against FakeSupabase. The browser path is in
test_agent_on_portal.py."""

import logging
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

import anthropic
import httpx2
import pytest
from agent_setup import (
    AMOUNT,
    AWKWARD_PASSWORDS,
    BILL_NUMBER,
    Setup,
    agent,
    assert_password_never_shown,
    make_setup,
    no_portal,
    password_forms,
)
from fake_model import END, HAPPY_PATH, REFUSAL, tool
from fake_portal import EMAIL, OUR_ACCOUNT, PASSWORD
from pydantic import SecretStr

from backend.payment_agent import model as model_module
from backend.payment_agent.agent import run_payment
from backend.payment_agent.model import AgentConfig, MissingApiKeyError
from backend.payment_agent.portal import (
    PaymentForm,
    PaymentNotSubmitted,
    PaymentOutcome,
    PortalBill,
    PortalBillStatus,
    PortalError,
    PortalReceipt,
    PortalTimeout,
    SignInFailed,
)
from backend.payment_agent.tools import PaymentTools, Redactor
from backend.schemas.payment_run import PaymentRunStatus

PORTAL_URL = "https://alder-creek-utility-demo.vercel.app"
OURS = PortalBill(BILL_NUMBER, Decimal(AMOUNT), "Nov 30, 2026", PortalBillStatus.due)


@dataclass
class StubPortal:
    """A PortalDriver that shows our bill, unpaid, and pays it."""

    bills: list[PortalBill] = field(default_factory=lambda: [OURS])
    outcome: PaymentOutcome = PaymentOutcome.successful
    receipt_bill: str = BILL_NUMBER
    password: str = PASSWORD
    sign_in_error: Exception | None = None
    list_error: Exception | None = None
    submit_error: Exception | None = None
    receipt_error: Exception | None = None
    on_list: Any = None
    calls: list[str] = field(default_factory=list)
    closed: bool = False

    def sign_in(self, email: str, password: SecretStr) -> None:
        self.calls.append("sign_in")
        assert (email, password.get_secret_value()) == (EMAIL, self.password)
        if self.sign_in_error:
            raise self.sign_in_error

    def list_bills(self, account_number: str) -> list[PortalBill]:
        self.calls.append("list_bills")
        if self.on_list:
            self.on_list()
        if self.list_error:
            raise self.list_error
        return self.bills

    def list_payments(self, account_number: str) -> list:
        return []

    def open_payment(self, account_number: str, bill_number: str) -> PaymentForm:
        return PaymentForm(account_number, bill_number, Decimal(AMOUNT))

    def submit_payment(self, expected: PaymentForm) -> PaymentOutcome:
        self.calls.append("submit")
        if self.submit_error:
            raise self.submit_error
        return self.outcome

    def read_receipt(self) -> PortalReceipt:
        self.calls.append("read_receipt")
        if self.receipt_error:
            raise self.receipt_error
        return PortalReceipt(
            account_number=OUR_ACCOUNT,
            confirmation_number="PAY-0001",
            bill_number=self.receipt_bill,
            amount=Decimal(AMOUNT),
            outcome=self.outcome,
            paid_on=date(2026, 11, 15),
        )

    def close(self) -> None:
        self.closed = True

    def submitted(self) -> bool:
        return "submit" in self.calls


def go(script, stub: StubPortal | None = None, setup: Setup | None = None, **kw):
    setup = setup or make_setup(PORTAL_URL)
    stub = stub or StubPortal()
    status, model = agent(setup, script, open_portal=lambda _url: stub, **kw)
    return setup, stub, status, model


def reason(setup: Setup) -> str:
    return setup.run["flag_reason"]


def test_happy_path_with_a_stub_portal():
    setup, stub, status, model = go(HAPPY_PATH)

    assert status is PaymentRunStatus.paid
    assert stub.closed
    assert setup.payments()[0]["provider_reference"] == "PAY-0001"
    assert setup.run["receipt"]["paid_on"] == "2026-11-15"
    assert len(model.requests) == 4  # the run ends with pay


def test_model_request_uses_the_configured_model_with_adaptive_thinking():
    config = AgentConfig(model="claude-sonnet-5-5")
    _setup, _stub, _status, model = go(HAPPY_PATH, config=config)

    request = model.requests[0]
    assert request["model"] == "claude-sonnet-5-5"
    assert request["thinking"] == {"type": "adaptive"}
    assert request["output_config"] == {"effort": "medium"}
    assert request["betas"] == ["server-side-fallback-2026-07-01"]
    assert request["fallbacks"] == "default"
    assert "budget_tokens" not in model.sent()
    assert request["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    assert {t["name"] for t in request["tools"]} == {
        "load_approved_bill",
        "sign_in",
        "list_portal_bills",
        "pay",
        "flag_for_person",
    }
    assert all(t["strict"] for t in request["tools"])


def test_thinking_blocks_are_passed_back_unchanged():
    _setup, _stub, _status, model = go(HAPPY_PATH)

    second = model.requests[1]["messages"]
    assert second[1]["role"] == "assistant"
    assert second[1]["content"][0] == {
        "type": "thinking",
        "thinking": "",
        "signature": "sig-1",
    }
    assert second[2]["content"][0]["type"] == "tool_result"


def test_model_setting_picks_the_model(monkeypatch):
    monkeypatch.setenv("PAYMENT_AGENT_MODEL", "claude-haiku-5-5")
    assert model_module.agent_config().model == "claude-haiku-5-5"
    monkeypatch.delenv("PAYMENT_AGENT_MODEL")
    assert model_module.agent_config().model == "claude-opus-5-5"


def test_no_model_client_without_an_api_key():
    with pytest.raises(MissingApiKeyError):
        model_module.create_model_client()


def test_real_sdk_builds_the_request_without_a_network_call():
    # The installed SDK accepts the agent's request (beta messages, refusal
    # fallback, adaptive thinking, strict tools); the transport answers locally.
    sent: list[bytes] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        sent.append(request.content)
        return httpx2.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": "claude-opus-5-5",
                "content": [{"type": "text", "text": "Done."}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )

    client = anthropic.Anthropic(
        api_key="test-key",
        http_client=anthropic.DefaultHttpxClient(
            transport=httpx2.MockTransport(answer)
        ),
    )
    setup = make_setup(PORTAL_URL)
    status = run_payment(
        setup.run_id, supabase=setup.db, model_client=client, open_portal=no_portal
    )

    assert status is PaymentRunStatus.flagged  # the model ended its turn
    body = sent[0].decode()
    assert '"fallbacks":"default"' in body
    assert '"thinking":{"type":"adaptive"}' in body
    assert "budget_tokens" not in body


# Limits


def test_time_limit_flags_the_run():
    ticks = iter([0.0, 0.0, 1000.0])
    setup, stub, status, model = go(HAPPY_PATH, clock=lambda: next(ticks, 1000.0))

    assert status is PaymentRunStatus.flagged
    assert "time limit" in reason(setup)
    assert len(model.requests) == 1
    assert not stub.submitted()


class Shutdown:
    """The worker's SIGTERM handler, as a run sees it: `request()` sets a
    deadline that has already passed (no time left to wrap up)."""

    def __init__(self) -> None:
        self.end_by: float | None = None

    def request(self) -> None:
        self.end_by = 0.0  # before any time.monotonic() reading

    def __call__(self) -> float | None:
        return self.end_by


def test_stopping_the_worker_before_paying_flags_the_run_with_nothing_paid():
    shutdown = Shutdown()
    stub = StubPortal(on_list=shutdown.request)  # SIGTERM while reading bills
    setup, stub, status, model = go(HAPPY_PATH, stub=stub, must_end_by=shutdown)

    assert status is PaymentRunStatus.flagged
    assert "worker was stopped" in reason(setup)
    assert len(model.requests) == 3  # no model call after the stop
    assert not stub.submitted() and setup.payments() == []
    assert stub.closed


def test_stopping_the_worker_after_the_portal_answered_saves_the_payment():
    shutdown = Shutdown()

    class StopAfterPaying(StubPortal):
        def submit_payment(self, expected: PaymentForm) -> PaymentOutcome:
            outcome = super().submit_payment(expected)
            shutdown.request()  # SIGTERM while the portal answers
            return outcome

    setup, stub, status, model = go(
        HAPPY_PATH, stub=StopAfterPaying(), must_end_by=shutdown
    )

    assert status is PaymentRunStatus.paid
    assert len(model.requests) == 4  # save_receipt was never asked for
    assert len(setup.payments()) == 1
    assert "worker was stopped" in str(setup.run["steps"])


def test_a_run_ending_before_the_shutdown_deadline_is_not_affected():
    setup, stub, status, model = go(HAPPY_PATH, must_end_by=lambda: 1e12)

    assert status is PaymentRunStatus.paid
    assert len(model.requests) == 5


def test_turn_limit_flags_the_run():
    script = [tool("load_approved_bill")] * 20
    setup, stub, status, model = go(script, config=AgentConfig(max_model_turns=4))

    assert status is PaymentRunStatus.flagged
    assert "limit of 4 model turns" in reason(setup)
    assert len(model.requests) == 4


def test_model_stopping_early_flags_the_run():
    setup, stub, status, _model = go([tool("load_approved_bill"), END])

    assert status is PaymentRunStatus.flagged
    assert "stopped without finishing" in reason(setup)


def test_refusal_flags_the_run():
    setup, _stub, status, _model = go([REFUSAL])

    assert "declined to continue" in reason(setup)


def test_model_api_error_flags_the_run():
    def unreachable():
        raise anthropic.APIConnectionError(
            request=httpx2.Request("POST", "https://api.anthropic.com")
        )

    setup, _stub, status, _model = go([unreachable])

    assert status is PaymentRunStatus.flagged
    assert "could not be reached" in reason(setup)


def test_flag_for_person_ends_the_run_with_the_reason():
    script = [tool("load_approved_bill"), tool("flag_for_person", reason="Odd page.")]
    setup, stub, status, model = go(script)

    assert status is PaymentRunStatus.flagged
    assert reason(setup) == "The agent flagged this run: Odd page."
    assert len(model.requests) == 2


# Tool rules


def test_out_of_order_calls_are_errors_the_model_can_recover_from():
    script = [tool("pay", bill_number=BILL_NUMBER), *HAPPY_PATH]
    setup, stub, status, model = go(script)

    assert status is PaymentRunStatus.paid
    first_result = model.requests[1]["messages"][2]["content"][0]
    assert first_result["is_error"] is True
    assert "load_approved_bill first" in first_result["content"]


def test_bad_tool_input_is_an_error():
    script = [tool("load_approved_bill", extra="x"), END]
    _setup, _stub, _status, model = go(script)

    result = model.requests[1]["messages"][2]["content"][0]
    assert result["is_error"] is True


def test_bill_not_approved_is_flagged_before_signing_in():
    setup = make_setup(PORTAL_URL)
    setup.bill["status"] = "pending_approval"
    setup, stub, status, _model = go(HAPPY_PATH, setup=setup)

    assert "pending approval, not approved" in reason(setup)
    assert stub.calls == []


def test_account_made_inactive_after_queueing_is_flagged_before_signing_in():
    setup = make_setup(PORTAL_URL)
    setup.account["status"] = "inactive"
    setup, stub, status, _model = go(HAPPY_PATH, setup=setup)

    assert status is PaymentRunStatus.flagged
    assert reason(setup) == "The vendor account is inactive. Nothing was paid."
    assert stub.calls == []
    assert setup.payments() == []


def test_account_made_inactive_before_paying_is_flagged():
    setup = make_setup(PORTAL_URL)

    def deactivate():
        setup.account["status"] = "inactive"

    setup, stub, status, _model = go(HAPPY_PATH, StubPortal(on_list=deactivate), setup)

    assert status is PaymentRunStatus.flagged
    assert reason(setup) == "The vendor account is inactive. Nothing was paid."
    assert not stub.submitted()
    assert setup.payments() == []


def test_bill_changed_after_loading_is_flagged():
    setup = make_setup(PORTAL_URL)

    def change_amount():
        setup.bill["amount"] = "200.00"

    setup, stub, status, _model = go(
        HAPPY_PATH, StubPortal(on_list=change_amount), setup
    )

    assert "changed after the run started" in reason(setup)
    assert not stub.submitted()


def test_plain_http_portal_is_refused():
    setup = make_setup("http://alder-creek-utility-demo.vercel.app")
    setup, stub, status, _model = go(HAPPY_PATH, setup=setup)

    assert "is not https" in reason(setup)
    assert stub.calls == []


def test_missing_password_is_flagged():
    setup = make_setup(PORTAL_URL)
    setup.db.rpc(
        "update_vendor_account",
        {
            "p_account_id": setup.account["account_id"],
            "p_changes": {},
            "p_password_action": "clear",
            "p_password": None,
        },
    ).execute()
    setup, stub, status, _model = go(HAPPY_PATH, setup=setup)

    assert "no portal email and password" in reason(setup)


def test_receipt_for_another_bill_is_not_recorded():
    setup, _stub, status, _model = go(HAPPY_PATH, StubPortal(receipt_bill="BILL-9"))

    assert status is PaymentRunStatus.flagged
    assert reason(setup) == (
        "The receipt (PAY-0001) is for bill BILL-9, not what was paid. The portal "
        "says the payment was successful, and it is not recorded here: check the "
        "portal before paying this bill again."
    )
    assert setup.payments() == []


def test_recording_refused_because_the_bill_was_paid_meanwhile_is_flagged():
    setup = make_setup(PORTAL_URL)

    def pay_by_hand():
        setup.bill["status"] = "paid"

    stub = StubPortal()
    original = stub.submit_payment

    def submit_then_paid_by_hand(expected):
        outcome = original(expected)
        pay_by_hand()
        return outcome

    stub.submit_payment = submit_then_paid_by_hand  # type: ignore[method-assign]
    setup, _stub, status, _model = go(HAPPY_PATH, stub, setup)

    assert status is PaymentRunStatus.flagged
    assert "PAY-0001" in reason(setup) and "reconcile" in reason(setup)
    assert "check the portal before paying this bill again" in reason(setup)


@pytest.mark.parametrize(
    "refusal",
    [
        "The payment page changed before paying.",
        "Could not find the Pay or Review payment button.",
        "The Pay button says $199.99, not $186.42.",
        "Timed out waiting for the portal while getting the payment ready.",
    ],
)
def test_refusal_before_the_final_click_says_only_nothing_was_paid(refusal):
    stub = StubPortal(submit_error=PaymentNotSubmitted(refusal))
    setup, stub, status, _model = go(HAPPY_PATH, stub)

    assert status is PaymentRunStatus.flagged
    assert reason(setup) == f"{refusal} Nothing was paid."
    assert setup.payments() == []
    assert setup.bill["status"] == "approved"


@pytest.mark.parametrize(
    "error",
    [
        PortalError("The portal showed an error after the payment was submitted."),
        PortalTimeout("Timed out waiting for the portal while submitting the payment."),
        # From the Review payment click on, the payment may be submitted.
        PortalError("The review screen does not say $186.42 for BILL-1001."),
    ],
)
def test_portal_error_after_submitting_says_to_check_the_portal(error):
    stub = StubPortal(submit_error=error)
    setup, _stub, status, _model = go(HAPPY_PATH, stub)

    assert status is PaymentRunStatus.flagged
    assert reason(setup).startswith(str(error))
    assert "check the portal before paying this bill again" in reason(setup)
    assert "Nothing was paid" not in reason(setup)


def test_unexpected_error_flags_the_run_and_keeps_the_secret_out(caplog):
    stub = StubPortal(submit_error=RuntimeError(f"boom {PASSWORD}"))
    setup, _stub, status, model = go(HAPPY_PATH, stub)

    assert status is PaymentRunStatus.flagged
    assert "unexpected error (RuntimeError)" in reason(setup)
    assert "check the portal" in reason(setup)
    assert "boom [redacted]" in caplog.text
    assert PASSWORD not in caplog.text


def test_portal_text_quoting_the_password_is_scrubbed(caplog):
    caplog.set_level(logging.INFO)
    stub = StubPortal(sign_in_error=SignInFailed(f"Bad password {PASSWORD}"))
    setup, _stub, status, model = go(HAPPY_PATH, stub)

    assert reason(setup) == "Bad password [redacted]"
    for text in (str(setup.run["steps"]), model.sent(), caplog.text):
        assert PASSWORD not in text


def test_a_run_ended_elsewhere_is_left_alone():
    setup = make_setup(PORTAL_URL)

    def flagged_by_the_stale_check():
        setup.run.update(
            status="flagged", flag_reason="Stale.", finished_at="2026-11-15T00:00:00Z"
        )

    stub = StubPortal(on_list=flagged_by_the_stale_check)
    setup, stub, status, _model = go(HAPPY_PATH, stub, setup)

    assert status is None
    assert not stub.submitted()
    assert stub.closed
    assert setup.run["flag_reason"] == "Stale."


def test_only_a_running_run_is_run():
    setup = make_setup(PORTAL_URL)
    setup.run.update(status="queued", started_at=None)

    status, model = agent(setup, HAPPY_PATH, open_portal=no_portal)

    assert status is None
    assert model.requests == []


# Recording the payment inside pay


def test_the_run_ends_inside_pay_so_no_tool_runs_after_it():
    # The model asks for more after pay; none of it runs, and the payment is
    # recorded from the receipt pay read before handing back.
    script = [
        *HAPPY_PATH[:4],
        tool("list_portal_bills"),
        tool("pay", bill_number=BILL_NUMBER),
        tool("flag_for_person", reason="Unsure."),
    ]
    setup, stub, status, model = go(script)

    assert status is PaymentRunStatus.paid
    assert len(model.requests) == 4
    assert stub.calls == [
        "sign_in",
        "list_bills",
        "list_bills",
        "submit",
        "read_receipt",
    ]
    [payment] = setup.payments()
    assert setup.run["payment_id"] == payment["payment_id"]


def test_pay_never_hands_back_to_the_model_with_the_payment_unrecorded(
    monkeypatch,
):
    # A pay that returned without recording would let the model's next tool
    # navigate away from the receipt: the run flags at once instead.
    monkeypatch.setattr(PaymentTools, "_record", lambda *_args: {"recorded": False})
    setup, stub, status, model = go([*HAPPY_PATH, tool("list_portal_bills")])

    assert status is PaymentRunStatus.flagged
    assert "unexpected error (RuntimeError)" in reason(setup)
    assert "check the portal before paying this bill again" in reason(setup)
    assert len(model.requests) == 4
    assert stub.calls.count("list_bills") == 2  # list_portal_bills and pay's own


@pytest.mark.parametrize(
    "error",
    [
        PortalTimeout("Timed out waiting for the portal while reading the receipt."),
        PortalError("The receipt is missing Amount."),
        RuntimeError("boom"),
    ],
)
def test_a_receipt_that_cannot_be_read_says_to_check_the_portal(error):
    setup, stub, status, _model = go(HAPPY_PATH, StubPortal(receipt_error=error))

    assert status is PaymentRunStatus.flagged
    assert stub.calls.count("submit") == 1
    assert "check the portal before paying this bill again" in reason(setup)
    assert "Nothing was paid" not in reason(setup)
    assert setup.payments() == []
    assert setup.bill["status"] == "approved"


# The password in escaped forms


def test_redactor_scrubs_nested_values_and_escaped_forms():
    for password in AWKWARD_PASSWORDS:
        redactor = Redactor()
        redactor.add(SecretStr(password))
        value = {"a": [f"x {password} y", {"b": password}], "c": 1}

        assert redactor.scrub_value(value) == {
            "a": ["x [redacted] y", {"b": "[redacted]"}],
            "c": 1,
        }
        for form in password_forms(password):
            assert redactor.scrub(f"<{form}>") == "<[redacted]>"


@pytest.mark.parametrize("password", AWKWARD_PASSWORDS)
@pytest.mark.parametrize("leak", ["portal text", "portal error", "crash"])
def test_an_awkward_password_never_shows_in_any_form(password, leak, caplog):
    caplog.set_level(logging.DEBUG)
    echoed = PortalBill(
        BILL_NUMBER, Decimal(AMOUNT), f"Nov 30 ({password})", PortalBillStatus.due
    )
    stub = {
        # The portal shows the password in a bill the model is sent.
        "portal text": StubPortal(bills=[echoed]),
        # A driver error quoting portal text with repr().
        "portal error": StubPortal(
            list_error=PortalError(f"Unknown bill status {password!r} on the portal.")
        ),
        # A bug whose traceback quotes it.
        "crash": StubPortal(submit_error=RuntimeError(f"boom {password!r}")),
    }[leak]
    stub.password = password
    setup = make_setup(PORTAL_URL, password=password)
    setup, _stub, _status, model = go(HAPPY_PATH, stub, setup)

    assert_password_never_shown(password, setup, model, caplog.text)

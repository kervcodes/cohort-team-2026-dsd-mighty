"""Setup for the payment agent tests: a FakeSupabase holding an approved bill
matched to a vendor account with a portal login, and a claimed run. Helpers,
not tests."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from fake_model import ScriptedModel
from fake_portal import EMAIL, OUR_ACCOUNT, PASSWORD
from fake_supabase import FakeSupabase

from backend.payment_agent.agent import run_payment
from backend.payment_agent.model import AgentConfig
from backend.payment_agent.portal import PortalDriver
from backend.schemas.payment_run import PaymentRunStatus
from backend.services.payment_run_repository import claim_next_run

APPROVER = str(uuid4())
ANALYST = str(uuid4())
BILL_NUMBER = "BILL-1001"
AMOUNT = "186.42"
# Passwords whose escaped forms differ from the raw text: in JSON (a quote, a
# backslash, non-ASCII) and in Python's repr (a backslash).
AWKWARD_PASSWORDS = ['Pw"q7-s3cret', "Pw\\q7-s3cret", "Pässwörd-q7"]


@dataclass
class Setup:
    db: FakeSupabase
    bill: dict[str, Any]
    account: dict[str, Any]
    run_id: UUID

    @property
    def run(self) -> dict[str, Any]:
        found = self.db.find("payment_runs", "run_id", str(self.run_id))
        assert found is not None
        return found

    def payments(self) -> list[dict[str, Any]]:
        return self.db.tables.get("payments", [])


def make_setup(portal_url: str, password: str = PASSWORD) -> Setup:
    db = FakeSupabase()
    db.add_user(APPROVER, role="approver", full_name="Ada Approver")
    vendor = db.add_vendor("Alder Creek Landscaping")
    prop = db.add_property()
    account = db.add_vendor_account(
        prop["property_id"],
        vendor["vendor_id"],
        account_number=OUR_ACCOUNT,
        portal_url=portal_url,
        portal_login_email=EMAIL,
    )
    db.rpc(
        "update_vendor_account",
        {
            "p_account_id": account["account_id"],
            "p_changes": {},
            "p_password_action": "set",
            "p_password": password,
        },
    ).execute()
    bill = db.add_bill(
        ANALYST,
        status="approved",
        amount=AMOUNT,
        invoice_number=BILL_NUMBER,
        due_date="2026-11-30",
        account_number_raw=OUR_ACCOUNT,
        vendor_account_id=account["account_id"],
    )
    db.add_payment_run(bill["bill_id"], APPROVER)
    claimed = claim_next_run(db)
    assert claimed is not None
    return Setup(db=db, bill=bill, account=account, run_id=claimed.id)


def agent(
    setup: Setup,
    script: list,
    open_portal: Any,
    config: AgentConfig | None = None,
    **kwargs: Any,
) -> tuple[PaymentRunStatus | None, ScriptedModel]:
    model = ScriptedModel(script)
    status = run_payment(
        setup.run_id,
        supabase=setup.db,  # type: ignore[arg-type]
        model_client=model,
        open_portal=open_portal,
        config=config or AgentConfig(portal_timeout_ms=5_000),
        **kwargs,
    )
    return status, model


def no_portal(_url: str) -> PortalDriver:
    raise AssertionError("this test must not open the portal")


def password_forms(password: str) -> set[str]:
    """The password as it would read in plain text, in JSON (ASCII-escaped
    or not) and in a Python repr or ascii()."""
    return {
        password,
        json.dumps(password)[1:-1],
        json.dumps(password, ensure_ascii=False)[1:-1],
        repr(password)[1:-1],
        ascii(password)[1:-1],
    }


def _strings(value: Any) -> Iterator[str]:
    """Every string in a JSON-like value, and in any string that is itself
    JSON (a tool result's content)."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(key)
            yield from _strings(item)
    elif isinstance(value, list | tuple):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, str):
        yield value
        try:
            decoded = json.loads(value)
        except ValueError:
            return
        if not isinstance(decoded, str):
            yield from _strings(decoded)


def assert_password_never_shown(
    password: str, setup: Setup, model: ScriptedModel, log_text: str
) -> None:
    """In no form: not in any model request (tool results included), the
    run's steps, flag reason or receipt, the payments, or the log."""
    forms = password_forms(password)
    seen = {
        "model request": list(_strings(model.requests)),
        "run": list(_strings(setup.run)),
        "payments": list(_strings(setup.payments())),
        "log": [log_text],
    }
    for where, texts in seen.items():
        for text in texts:
            for form in forms:
                assert form not in text, f"the password ({form!r}) is in a {where}"

"""Setup for the payment agent tests: a FakeSupabase holding an approved bill
matched to a vendor account with a portal login, and a claimed run. Helpers,
not tests."""

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

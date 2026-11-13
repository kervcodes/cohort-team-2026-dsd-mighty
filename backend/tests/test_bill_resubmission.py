from uuid import uuid4

import pytest
from fake_supabase import FakeSupabase


def test_resubmit_rejected_bill_creates_new_pending_approval():
    db = FakeSupabase()
    user_id = str(uuid4())

    bill = db.add_bill(
        submitted_by=user_id,
        status="rejected",
        invoice_number="INV-100",
        amount=4500,
    )

    previous_approval = db.add_approval(
        bill["bill_id"],
        approval_status="rejected",
        comments="Incorrect invoice amount",
    )

    result = db.rpc(
        "resubmit_bill_with_approval",
        {
            "p_bill_id": bill["bill_id"],
            "p_fields": {
                "invoice_number": "INV-100",
                "amount": 4200,
            },
            "p_user_id": user_id,
        },
    ).execute()

    assert result.data == bill["bill_id"]
    assert bill["status"] == "pending_approval"
    assert bill["amount"] == 4200

    approvals = db.tables["approvals"]

    assert len(approvals) == 2
    assert previous_approval["approval_status"] == "rejected"

    new_approval = next(
        approval for approval in approvals if approval["approval_status"] == "pending"
    )

    assert new_approval["bill_id"] == bill["bill_id"]
    assert new_approval["approval_id"] != previous_approval["approval_id"]


def test_resubmit_rejected_bill_requires_original_submitter():
    db = FakeSupabase()
    owner_id = str(uuid4())
    another_user_id = str(uuid4())

    bill = db.add_bill(
        submitted_by=owner_id,
        status="rejected",
    )

    db.add_approval(
        bill["bill_id"],
        approval_status="rejected",
    )

    with pytest.raises(ValueError, match="not authorized"):
        db.resubmit_bill_with_approval(
            bill_id=bill["bill_id"],
            fields={},
            user_id=another_user_id,
        )

    assert bill["status"] == "rejected"
    assert len(db.tables["approvals"]) == 1


def test_resubmit_bill_requires_rejected_status():
    db = FakeSupabase()
    user_id = str(uuid4())

    bill = db.add_bill(
        submitted_by=user_id,
        status="approved",
    )

    with pytest.raises(ValueError, match="Only rejected"):
        db.resubmit_bill_with_approval(
            bill_id=bill["bill_id"],
            fields={},
            user_id=user_id,
        )

    assert bill["status"] == "approved"
    assert db.tables.get("approvals", []) == []


def test_resubmit_bill_rejects_existing_pending_approval():
    db = FakeSupabase()
    user_id = str(uuid4())

    bill = db.add_bill(
        submitted_by=user_id,
        status="rejected",
    )

    db.add_approval(
        bill["bill_id"],
        approval_status="pending",
    )

    with pytest.raises(ValueError, match="already has a pending"):
        db.resubmit_bill_with_approval(
            bill_id=bill["bill_id"],
            fields={},
            user_id=user_id,
        )

    assert bill["status"] == "rejected"
    assert len(db.tables["approvals"]) == 1

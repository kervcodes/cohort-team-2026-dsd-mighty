from uuid import UUID, uuid4

import pytest
from fake_supabase import FakeSupabase

from backend.schemas.approval import ApprovalDecisionType
from backend.services.approval_repository import (
    decide_approval,
    get_approval,
    list_approvals,
)


def seed_approval(
    db: FakeSupabase,
    *,
    role: str = "approver",
    reviewer_status: str = "active",
    amount: float = 250.00,
    approval_status: str = "pending",
    bill_status: str = "pending_approval",
    requested_at: str = "2026-11-12T10:00:00+00:00",
):
    reviewer_id = uuid4()

    db.add_user(
        str(reviewer_id),
        role=role,
        status=reviewer_status,
        full_name="Alex Reviewer",
    )

    bill = db.add_bill(
        str(reviewer_id),
        status=bill_status,
        amount=amount,
    )

    approval = db.add_approval(
        bill["bill_id"],
        reviewer_id=(str(reviewer_id) if approval_status != "pending" else None),
        approval_status=approval_status,
        requested_at=requested_at,
    )

    return {
        "reviewer_id": reviewer_id,
        "bill_id": UUID(bill["bill_id"]),
        "approval_id": UUID(approval["approval_id"]),
    }


def test_list_approvals_returns_pending_approvals_with_reviewer():
    db = FakeSupabase()

    seed_approval(
        db,
        approval_status="approved",
        bill_status="approved",
    )

    results = list_approvals(client=db)

    assert len(results) == 0


def test_list_approvals_maps_reviewer_details():
    db = FakeSupabase()

    seeded = seed_approval(
        db,
        approval_status="approved",
        bill_status="approved",
    )

    results = list_approvals(
        client=db,
        status_filter="approved",
    )

    assert len(results) == 1

    approval = results[0]

    assert approval.id == seeded["approval_id"]
    assert approval.bill_id == seeded["bill_id"]
    assert approval.status == "approved"
    assert approval.reviewer is not None
    assert approval.reviewer.id == seeded["reviewer_id"]
    assert approval.reviewer.full_name == "Alex Reviewer"


def test_list_approvals_filters_by_bill_id():
    db = FakeSupabase()

    first = seed_approval(db)
    seed_approval(db)

    results = list_approvals(
        client=db,
        bill_id=first["bill_id"],
    )

    assert len(results) == 1
    assert results[0].bill_id == first["bill_id"]


def test_list_approvals_applies_pagination():
    db = FakeSupabase()

    seed_approval(
        db,
        requested_at="2026-11-10T10:00:00+00:00",
    )
    second = seed_approval(
        db,
        requested_at="2026-11-11T10:00:00+00:00",
    )
    seed_approval(
        db,
        requested_at="2026-11-12T10:00:00+00:00",
    )

    results = list_approvals(
        client=db,
        skip=1,
        limit=1,
    )

    assert len(results) == 1
    assert results[0].id == second["approval_id"]


def test_get_approval_returns_approval_when_found():
    db = FakeSupabase()

    seeded = seed_approval(db)

    result = get_approval(
        client=db,
        approval_id=seeded["approval_id"],
    )

    assert result is not None
    assert result.id == seeded["approval_id"]
    assert result.bill_id == seeded["bill_id"]
    assert result.status == "pending"
    assert result.reviewer is None


def test_get_approval_returns_none_when_not_found():
    db = FakeSupabase()

    result = get_approval(
        client=db,
        approval_id=uuid4(),
    )

    assert result is None


def test_decide_approval_approves_and_returns_updated_record():
    db = FakeSupabase()

    seeded = seed_approval(db)

    result = decide_approval(
        client=db,
        approval_id=seeded["approval_id"],
        reviewer_id=seeded["reviewer_id"],
        decision=ApprovalDecisionType.APPROVE,
    )

    assert result.id == seeded["approval_id"]
    assert result.bill_id == seeded["bill_id"]
    assert result.status == "approved"
    assert result.reviewer is not None
    assert result.reviewer.id == seeded["reviewer_id"]
    assert result.decided_at is not None


def test_decide_approval_rejects_and_returns_comments():
    db = FakeSupabase()

    seeded = seed_approval(db)

    result = decide_approval(
        client=db,
        approval_id=seeded["approval_id"],
        reviewer_id=seeded["reviewer_id"],
        decision=ApprovalDecisionType.REJECT,
        comments="Invoice amount does not match the contract.",
    )

    assert result.status == "rejected"
    assert result.comments == ("Invoice amount does not match the contract.")
    assert result.reviewer is not None
    assert result.reviewer.id == seeded["reviewer_id"]
    assert result.decided_at is not None


def test_decide_approval_raises_when_updated_record_cannot_be_retrieved():
    class MissingApprovalClient:
        def rpc(self, function, params):
            class Result:
                def execute(self):
                    return None

            return Result()

        def table(self, table_name):
            return self

        def select(self, columns):
            return self

        def eq(self, column, value):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            class Response:
                data = None

            return Response()

    with pytest.raises(
        RuntimeError,
        match="Approval was decided but could not be retrieved.",
    ):
        decide_approval(
            client=MissingApprovalClient(),
            approval_id=uuid4(),
            reviewer_id=uuid4(),
            decision=ApprovalDecisionType.APPROVE,
        )


def test_approver_can_approve_bill_of_5000():
    db = FakeSupabase()
    seeded = seed_approval(db, role="approver", amount=5000)

    result = decide_approval(
        client=db,
        approval_id=seeded["approval_id"],
        reviewer_id=seeded["reviewer_id"],
        decision=ApprovalDecisionType.APPROVE,
    )

    assert result.status == "approved"


def test_approver_cannot_approve_bill_over_5000():
    db = FakeSupabase()
    seeded = seed_approval(db, role="approver", amount=5000.01)

    with pytest.raises(ValueError, match="admin must review"):
        decide_approval(
            client=db,
            approval_id=seeded["approval_id"],
            reviewer_id=seeded["reviewer_id"],
            decision=ApprovalDecisionType.APPROVE,
        )


def test_admin_can_approve_bill_over_5000():
    db = FakeSupabase()
    seeded = seed_approval(db, role="admin", amount=7500)

    result = decide_approval(
        client=db,
        approval_id=seeded["approval_id"],
        reviewer_id=seeded["reviewer_id"],
        decision=ApprovalDecisionType.APPROVE,
    )

    assert result.status == "approved"


@pytest.mark.parametrize("comments", [None, "", "   "])
def test_rejection_requires_nonempty_comment(comments):
    db = FakeSupabase()
    seeded = seed_approval(db)

    with pytest.raises(ValueError, match="comment is required"):
        decide_approval(
            client=db,
            approval_id=seeded["approval_id"],
            reviewer_id=seeded["reviewer_id"],
            decision=ApprovalDecisionType.REJECT,
            comments=comments,
        )


def test_inactive_reviewer_cannot_decide_approval():
    db = FakeSupabase()
    seeded = seed_approval(db, reviewer_status="inactive")

    with pytest.raises(ValueError, match="not active"):
        decide_approval(
            client=db,
            approval_id=seeded["approval_id"],
            reviewer_id=seeded["reviewer_id"],
            decision=ApprovalDecisionType.APPROVE,
        )


def test_approval_cannot_be_decided_twice():
    db = FakeSupabase()
    seeded = seed_approval(db)

    decide_approval(
        client=db,
        approval_id=seeded["approval_id"],
        reviewer_id=seeded["reviewer_id"],
        decision=ApprovalDecisionType.APPROVE,
    )

    with pytest.raises(ValueError, match="already been decided"):
        decide_approval(
            client=db,
            approval_id=seeded["approval_id"],
            reviewer_id=seeded["reviewer_id"],
            decision=ApprovalDecisionType.REJECT,
            comments="Trying to reverse the decision.",
        )

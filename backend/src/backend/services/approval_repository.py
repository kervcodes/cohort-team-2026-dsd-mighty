from uuid import UUID

from backend.schemas.approval import ApprovalDecisionType, ApprovalRead
from backend.schemas.common import ApprovalStatus

APPROVAL_COLUMNS = (
    "approval_id,bill_id,approval_status,decision_at,"
    "comments,requested_at,"
    "reviewer:app_users!reviewer_id(user_id,full_name)"
)


def _to_approval(row: dict) -> ApprovalRead:
    reviewer_row = row.get("reviewer")

    reviewer = None
    if reviewer_row:
        reviewer = {
            "id": reviewer_row["user_id"],
            "full_name": reviewer_row["full_name"],
        }

    return ApprovalRead.model_validate(
        {
            "id": row["approval_id"],
            "bill_id": row["bill_id"],
            "status": row["approval_status"],
            "reviewer": reviewer,
            "comments": row["comments"],
            "requested_at": row["requested_at"],
            "decided_at": row["decision_at"],
        }
    )


def list_approvals(
    client,
    status_filter: ApprovalStatus = "pending",
    bill_id: UUID | None = None,
    skip: int = 0,
    limit: int = 25,
) -> list[ApprovalRead]:
    query = (
        client.table("approvals")
        .select(APPROVAL_COLUMNS)
        .eq("approval_status", status_filter)
    )

    if bill_id is not None:
        query = query.eq("bill_id", str(bill_id))

    response = query.order("requested_at").range(skip, skip + limit - 1).execute()

    return [_to_approval(row) for row in (response.data or [])]


def get_approval(
    client,
    approval_id: UUID,
) -> ApprovalRead | None:
    response = (
        client.table("approvals")
        .select(APPROVAL_COLUMNS)
        .eq("approval_id", str(approval_id))
        .maybe_single()
        .execute()
    )

    if response is None or not response.data:
        return None

    return _to_approval(response.data)


def decide_approval(
    client,
    approval_id: UUID,
    reviewer_id: UUID,
    decision: ApprovalDecisionType,
    comments: str | None = None,
) -> ApprovalRead:
    client.rpc(
        "decide_bill_approval",
        {
            "p_approval_id": str(approval_id),
            "p_reviewer_id": str(reviewer_id),
            "p_decision": decision.value,
            "p_comments": comments,
        },
    ).execute()

    approval = get_approval(
        client=client,
        approval_id=approval_id,
    )

    if approval is None:
        raise RuntimeError("Approval was decided but could not be retrieved.")

    return approval

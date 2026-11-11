"""Who may see and change which bills. Every bill rule lives here.

The bill routes use the service-role client, which bypasses row-level
security, so these rules, applied as query filters by `bill_repository`, are
the only guard. Each rule has a test in tests/test_bill_rules.py.
"""

from enum import StrEnum
from uuid import UUID

from backend.schemas.bill import BillStatus
from backend.schemas.user import UserRole

# Who may use the bill routes (active users only). The routes depend on these;
# tests/test_route_permissions.py checks them against the role table.
BILL_READERS = (UserRole.analyst, UserRole.approver, UserRole.admin)
BILL_WRITERS = (UserRole.analyst, UserRole.admin)


class BillScope(StrEnum):
    mine = "mine"
    all = "all"


def default_scope(role: UserRole) -> BillScope:
    """Analysts start on their own bills; approvers and admins, who review
    everyone's, start on all of them."""
    return BillScope.mine if role is UserRole.analyst else BillScope.all


def readable_bills(user_id: UUID, scope: BillScope) -> str:
    """PostgREST `or` filter for the bills `user_id` may read in `scope`.

    Every submitted bill is readable, but a draft is work in progress: only
    its author sees it. `user_id` is a UUID, so it cannot inject filter syntax.
    """
    own = f"submitted_by.eq.{user_id}"
    if scope is BillScope.mine:
        return own
    return f"{own},status.neq.{BillStatus.draft}"


def editable_bills(user_id: str) -> dict[str, str]:
    """Column -> value filters (all must match) for the bills `user_id` may
    change: only their own drafts."""
    return {"submitted_by": user_id, "status": BillStatus.draft}

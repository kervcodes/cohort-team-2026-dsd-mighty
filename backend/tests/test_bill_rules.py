"""One test per rule in `backend.services.bill_access`.

The filter rules are checked by the rows they let through, run against
FakeSupabase, not by their text. Who may call each bill route at all
(`BILL_READERS`, `BILL_WRITERS`, active users only) is checked by the role
table in test_route_permissions.py.
"""

from uuid import uuid4

import pytest
from fake_supabase import FakeSupabase

from backend.schemas.bill import BillStatus
from backend.schemas.user import UserRole
from backend.services.bill_access import (
    BillScope,
    default_scope,
    editable_bills,
    own_bills,
    readable_bills,
)

ME = uuid4()
OTHER = uuid4()
SUBMITTED = [status for status in BillStatus if status is not BillStatus.draft]


@pytest.fixture
def db() -> FakeSupabase:
    fake = FakeSupabase()
    for owner in (ME, OTHER):
        for status in BillStatus:
            fake.add_bill(str(owner), status=status, invoice_number=f"{owner}:{status}")
    return fake


def readable(db: FakeSupabase, scope: BillScope) -> set[tuple[str, str]]:
    query = db.table("bills").select("*").or_(readable_bills(ME, scope))
    return {(row["submitted_by"], row["status"]) for row in query.execute().data}


def matching(db: FakeSupabase, filters: dict[str, str]) -> set[tuple[str, str]]:
    query = db.table("bills").select("*")
    for column, value in filters.items():
        query = query.eq(column, value)
    return {(row["submitted_by"], row["status"]) for row in query.execute().data}


def editable(db: FakeSupabase) -> set[tuple[str, str]]:
    return matching(db, editable_bills(str(ME)))


def test_analysts_default_to_their_own_bills():
    assert default_scope(UserRole.analyst) is BillScope.mine


@pytest.mark.parametrize("role", [UserRole.approver, UserRole.admin])
def test_approvers_and_admins_default_to_all_bills(role):
    assert default_scope(role) is BillScope.all


def test_mine_is_every_own_bill_and_nothing_else(db):
    assert readable(db, BillScope.mine) == {(str(ME), s) for s in BillStatus}


def test_all_includes_everyone_elses_submitted_bills(db):
    assert {(str(OTHER), s) for s in SUBMITTED} <= readable(db, BillScope.all)


def test_all_hides_everyone_elses_drafts(db):
    assert (str(OTHER), BillStatus.draft) not in readable(db, BillScope.all)


def test_all_keeps_your_own_drafts(db):
    assert (str(ME), BillStatus.draft) in readable(db, BillScope.all)


def test_only_your_own_drafts_are_editable(db):
    assert editable(db) == {(str(ME), BillStatus.draft)}


def test_own_bills_are_every_bill_you_submitted_and_nothing_else(db):
    assert matching(db, own_bills(str(ME))) == {(str(ME), s) for s in BillStatus}

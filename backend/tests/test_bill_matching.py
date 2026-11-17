"""Bills point at the vendor account they belong to (vendor_account_matching).

Runs the real routes and repository queries against FakeSupabase, which
enforces the bills foreign keys and the bills_account_invoice_unique index.
"""

import json
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole
from backend.services.vendor_account_matching import (
    normalize_account_number,
    same_account_number,
)

USER_A = str(uuid4())
USER_B = str(uuid4())
DUPLICATE = "This invoice number is already in the system for this vendor account."
EXPECTED_BILLS = Path(__file__).parents[1] / "evals" / "bills" / "expected"

BILL = {
    "account_number_raw": "2000-4567 00",
    "invoice_number": "INV-1",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "250.00",
}


@pytest.fixture
def db():
    fake = FakeSupabase()
    fake.add_user(USER_A)
    fake.add_user(USER_B)
    with (
        patch("backend.api.bills.get_admin_supabase", return_value=fake),
        patch("backend.api.vendor_accounts.get_admin_supabase", return_value=fake),
    ):
        yield fake


@pytest.fixture
def prop(db):
    return db.add_property("Elm Court")


@pytest.fixture
def vendor(db):
    return db.add_vendor("Alder Creek Landscaping")


@pytest.fixture
def account(db, prop, vendor):
    return db.add_vendor_account(
        prop["property_id"], vendor["vendor_id"], account_number="2000456700"
    )


def as_user(user_id: str = USER_A, role: UserRole = UserRole.analyst) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id, role=role)
    return TestClient(app)


def match_of(row: dict) -> tuple:
    return tuple(
        row.get(key) for key in ("vendor_account_id", "vendor_id", "property_id")
    )


def matched_to(account: dict) -> tuple:
    return (account["account_id"], account["vendor_id"], account["property_id"])


UNMATCHED = (None, None, None)


# The rule.


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("2000456700", "2000456700"),
        ("2000-4567-00", "2000456700"),
        (" 2000 4567 00 ", "2000456700"),
        ("ACC-100", "acc100"),
        ("acc.100/", "acc100"),
        ("Acc_100#", "acc100"),
        ("---", ""),
    ],
)
def test_normalize_keeps_letters_and_digits_lowercased(raw, normalized):
    assert normalize_account_number(raw) == normalized


def test_same_account_number_compares_normalized_numbers():
    accounts = [{"account_number": "ACC-100"}, {"account_number": "ACC-200"}]

    assert same_account_number(accounts, "acc 100") == [accounts[0]]
    assert same_account_number(accounts, "ACC-300") == []


@pytest.mark.parametrize("number", [None, "", " - "])
def test_a_number_with_no_letters_or_digits_matches_nothing(number):
    assert same_account_number([{"account_number": "-"}], number) == []


# Every write path sets the match.


def create(body: dict = BILL):
    return as_user().post("/bills", json=body)


def save_draft(body: dict = BILL):
    return as_user().post("/bills/drafts", json=body)


def write(db, path: str, body: dict):
    """Send `body` down one write path; return the response and the bill row."""
    if path == "create":
        response = create(body)
    elif path == "draft":
        response = save_draft(body)
    else:
        draft = db.add_bill(USER_A)
        client = as_user()
        if path == "update":
            response = client.patch(f"/bills/{draft['bill_id']}/draft", json=body)
        else:
            response = client.post(f"/bills/{draft['bill_id']}/submit", json=body)
    rows = db.tables.get("bills", [])
    return response, rows[-1] if rows else None


WRITE_PATHS = ["create", "draft", "update", "submit"]


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_exactly_one_matching_account_is_the_match(db, account, path):
    response, row = write(db, path, BILL)

    assert response.status_code in (200, 201), response.text
    assert match_of(row) == matched_to(account)
    assert row["vendor_account_picked"] is False


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_no_matching_account_leaves_the_bill_unmatched(db, account, path):
    response, row = write(db, path, {**BILL, "account_number_raw": "9999"})

    assert response.status_code in (200, 201), response.text
    assert match_of(row) == UNMATCHED
    assert row["vendor_account_picked"] is False


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_several_matching_accounts_leave_the_bill_unmatched(db, account, path):
    other_property = db.add_property("Oak Row")
    db.add_vendor_account(
        other_property["property_id"], account["vendor_id"], account_number="2000456700"
    )

    response, row = write(db, path, BILL)

    assert response.status_code in (200, 201), response.text
    assert match_of(row) == UNMATCHED


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_inactive_accounts_are_ignored(db, account, path):
    other_property = db.add_property("Oak Row")
    db.add_vendor_account(
        other_property["property_id"],
        account["vendor_id"],
        account_number="2000-456700",
        status="inactive",
    )

    response, row = write(db, path, BILL)

    assert response.status_code in (200, 201), response.text
    assert match_of(row) == matched_to(account)


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_the_analysts_pick_wins_over_the_account_number(db, account, path):
    picked = db.add_vendor_account(
        db.add_property("Oak Row")["property_id"],
        db.add_vendor("Brightwater")["vendor_id"],
        account_number="5555",
    )

    response, row = write(db, path, {**BILL, "vendor_account_id": picked["account_id"]})

    assert response.status_code in (200, 201), response.text
    assert match_of(row) == matched_to(picked)
    assert row["vendor_account_picked"] is True


@pytest.mark.parametrize("path", ["update", "submit"])
def test_a_write_without_a_pick_marks_the_match_not_picked(db, account, path):
    other = db.add_vendor_account(
        db.add_property("Oak Row")["property_id"], account["vendor_id"]
    )
    draft = db.add_bill(
        USER_A,
        account_number_raw=BILL["account_number_raw"],
        vendor_account_id=other["account_id"],
        vendor_id=other["vendor_id"],
        property_id=other["property_id"],
        vendor_account_picked=True,
    )
    client = as_user()
    url = f"/bills/{draft['bill_id']}"

    if path == "update":
        response = client.patch(f"{url}/draft", json={"vendor_account_id": None})
    else:
        response = client.post(f"{url}/submit", json=BILL)

    assert response.status_code == 200, response.text
    assert match_of(draft) == matched_to(account)
    assert draft["vendor_account_picked"] is False


@pytest.mark.parametrize("path", WRITE_PATHS)
@pytest.mark.parametrize(
    ("status", "detail"),
    [
        (None, "Vendor account not found."),
        ("inactive", "This vendor account is inactive."),
    ],
)
def test_a_pick_that_cannot_be_used_is_422_and_writes_nothing(
    db, account, path, status, detail
):
    if status is None:
        picked_id = str(uuid4())
    else:
        picked_id = account["account_id"]
        account["status"] = status
    before = [dict(row) for row in db.tables.get("bills", [])]

    response, _ = write(db, path, {**BILL, "vendor_account_id": picked_id})

    assert (response.status_code, response.json()) == (422, {"detail": detail})
    after = db.tables.get("bills", [])
    # A draft the update or submit path added for the test is unchanged.
    assert after[: len(before)] == before
    assert all(match_of(row) == UNMATCHED for row in after)
    assert all(row["status"] == "draft" for row in after[len(before) :])


def test_a_not_a_uuid_pick_is_422(db, account):
    assert create({**BILL, "vendor_account_id": "nope"}).status_code == 422


# Reads.


def test_bill_reads_return_the_match(db, account):
    created = create().json()
    picked = create(
        {**BILL, "invoice_number": "INV-2", "vendor_account_id": account["account_id"]}
    ).json()

    listed = {row["id"]: row for row in as_user().get("/bills").json()}

    for bill, was_picked in ((created, False), (picked, True)):
        assert match_of(bill) == matched_to(account)
        assert bill["vendor_account_picked"] is was_picked
        for body in (as_user().get(f"/bills/{bill['id']}").json(), listed[bill["id"]]):
            assert match_of(body) == matched_to(account)
            assert body["vendor_account_picked"] is was_picked


@pytest.mark.parametrize("was_picked", [False, True])
def test_a_reopened_draft_returns_its_vendor_account_and_how_it_was_set(
    db, account, was_picked
):
    pick = {"vendor_account_id": account["account_id"]} if was_picked else {}
    draft_id = save_draft({**BILL, **pick}).json()["bill_id"]

    draft = as_user().get(f"/bills/{draft_id}/draft").json()

    assert draft["vendor_account_id"] == account["account_id"]
    assert draft["vendor_account_picked"] is was_picked


# Draft updates are partial.


def patch_draft(bill_id: str, body: dict):
    return as_user().patch(f"/bills/{bill_id}/draft", json=body)


def test_an_update_without_the_number_or_the_pick_keeps_the_match(db, account):
    draft_id = save_draft().json()["bill_id"]

    assert patch_draft(draft_id, {"amount": "300.00"}).status_code == 200

    (row,) = db.tables["bills"]
    assert row["amount"] == "300.00"
    assert match_of(row) == matched_to(account)


def test_an_update_to_an_unmatched_number_clears_the_match(db, account):
    draft_id = save_draft().json()["bill_id"]

    assert patch_draft(draft_id, {"account_number_raw": "9999"}).status_code == 200

    assert match_of(db.tables["bills"][0]) == UNMATCHED


def test_clearing_the_pick_matches_the_stored_number_again(db, account):
    picked = db.add_vendor_account(
        db.add_property("Oak Row")["property_id"],
        account["vendor_id"],
        account_number="5555",
    )
    draft_id = save_draft({**BILL, "vendor_account_id": picked["account_id"]}).json()[
        "bill_id"
    ]

    assert patch_draft(draft_id, {"vendor_account_id": None}).status_code == 200

    assert match_of(db.tables["bills"][0]) == matched_to(account)


# A match the number found is worked out again; a pick stays.


def add_same_number_account(db, account) -> dict:
    """A second active account with `account`'s number: the number is now
    ambiguous, so the rule leaves a bill with it unmatched."""
    return db.add_vendor_account(
        db.add_property("Oak Row")["property_id"],
        db.add_vendor("Brightwater")["vendor_id"],
        account_number=account["account_number"],
    )


@pytest.mark.parametrize(
    ("path", "body"),
    [
        # Save Draft from the form: every field, the pick left null.
        ("update", {**BILL, "vendor_account_id": None}),
        # Any other save: the number and the pick are not sent.
        ("update", {"amount": "300.00"}),
        ("update", {}),
        # Create from the form: no pick.
        ("submit", BILL),
    ],
)
def test_a_found_match_that_is_now_ambiguous_ends_unmatched(db, account, path, body):
    draft_id = save_draft().json()["bill_id"]
    (row,) = db.tables["bills"]
    assert match_of(row) == matched_to(account)
    add_same_number_account(db, account)
    reopened = as_user().get(f"/bills/{draft_id}/draft").json()
    assert reopened["vendor_account_picked"] is False

    if path == "update":
        response = patch_draft(draft_id, body)
    else:
        response = as_user().post(f"/bills/{draft_id}/submit", json=body)

    assert response.status_code == 200, response.text
    assert match_of(row) == UNMATCHED
    assert row["vendor_account_picked"] is False


def test_a_found_match_follows_the_account_the_number_now_finds(db, account):
    draft_id = save_draft().json()["bill_id"]
    account["status"] = "inactive"
    replacement = add_same_number_account(db, account)

    assert patch_draft(draft_id, {"amount": "300.00"}).status_code == 200

    assert match_of(db.tables["bills"][0]) == matched_to(replacement)


@pytest.mark.parametrize(
    ("path", "body"),
    [
        # Save Draft from the form sends the pick back.
        ("update", "pick"),
        # A save that does not send the number or the pick keeps it.
        ("update", {"amount": "300.00"}),
        ("update", {}),
        # Create from the form sends the pick back.
        ("submit", "pick"),
    ],
)
def test_a_pick_survives_reopening(db, account, path, body):
    add_same_number_account(db, account)
    pick = {**BILL, "vendor_account_id": account["account_id"]}
    draft_id = save_draft(pick).json()["bill_id"]
    reopened = as_user().get(f"/bills/{draft_id}/draft").json()
    assert reopened["vendor_account_id"] == account["account_id"]
    assert reopened["vendor_account_picked"] is True

    body = pick if body == "pick" else body
    if path == "update":
        response = patch_draft(draft_id, body)
    else:
        response = as_user().post(f"/bills/{draft_id}/submit", json=body)

    assert response.status_code == 200, response.text
    (row,) = db.tables["bills"]
    assert match_of(row) == matched_to(account)
    assert row["vendor_account_picked"] is True


def test_an_update_to_another_users_draft_is_404_and_changes_nothing(db, account):
    draft = db.add_bill(USER_B, account_number_raw="2000456700")

    response = patch_draft(draft["bill_id"], {"vendor_account_id": None})

    assert response.status_code == 404
    assert match_of(db.tables["bills"][0]) == (None, None, None)


# The same invoice number twice for one account.


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_a_duplicate_invoice_for_the_account_is_409(db, account, path):
    db.add_bill(
        USER_B,
        status="pending_approval",
        invoice_number=" inv-1 ",
        vendor_account_id=account["account_id"],
    )
    before = [dict(row) for row in db.tables["bills"]]

    response, _ = write(db, path, BILL)

    assert (response.status_code, response.json()) == (409, {"detail": DUPLICATE})
    after = db.tables["bills"]
    assert after[: len(before)] == before
    # Nothing new is matched or submitted: the failed write changed nothing.
    assert all(match_of(row) == UNMATCHED for row in after[len(before) :])
    assert all(row["status"] == "draft" for row in after[len(before) :])


def test_the_same_invoice_number_for_another_account_is_fine(db, account):
    db.add_bill(
        USER_B,
        invoice_number="INV-1",
        vendor_account_id=db.add_vendor_account(
            db.add_property("Oak Row")["property_id"], account["vendor_id"]
        )["account_id"],
    )

    assert create().status_code == 201


def test_unmatched_bills_may_share_an_invoice_number(db, account):
    unmatched = {**BILL, "account_number_raw": "9999"}

    assert create(unmatched).status_code == 201
    assert create(unmatched).status_code == 201


def test_submitting_a_matched_draft_does_not_conflict_with_itself(db, account):
    draft_id = save_draft().json()["bill_id"]

    response = as_user().post(f"/bills/{draft_id}/submit", json=BILL)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending_approval"


# The demo bills (DC-37 seeds one account per demo bill).


def test_every_demo_bill_matches_its_seeded_account(db, prop):
    accounts = {}
    for suffix in range(10):
        number = f"20004567{suffix:02d}"
        vendor = db.add_vendor(f"Demo vendor {suffix}")
        accounts[number] = db.add_vendor_account(
            prop["property_id"], vendor["vendor_id"], account_number=number
        )
    demo_bills = sorted(EXPECTED_BILLS.glob("*-bill.json"))
    assert len(demo_bills) == 10

    for path in demo_bills:
        expected = json.loads(path.read_text())
        body = {"account_number_raw": expected["account_number"]}

        response = save_draft(body)

        assert response.status_code == 201, response.text
        row = db.tables["bills"][-1]
        assert match_of(row) == matched_to(accounts[expected["account_number"]])


# GET /vendor-accounts


def test_lookup_lists_active_accounts_by_vendor_then_number(db, prop):
    zeta = db.add_vendor("zeta Water")
    acme = db.add_vendor("Acme Power")
    db.add_vendor_account(prop["property_id"], zeta["vendor_id"], account_number="1")
    db.add_vendor_account(prop["property_id"], acme["vendor_id"], account_number="B-2")
    db.add_vendor_account(prop["property_id"], acme["vendor_id"], account_number="A-9")
    db.add_vendor_account(
        prop["property_id"], acme["vendor_id"], account_number="A-1", status="inactive"
    )

    response = as_user(role=UserRole.approver).get("/vendor-accounts")

    assert response.status_code == 200
    body = response.json()
    assert [(row["vendor_name"], row["account_number"]) for row in body] == [
        ("Acme Power", "A-9"),
        ("Acme Power", "B-2"),
        ("zeta Water", "1"),
    ]
    assert set(body[0]) == {
        "id",
        "account_number",
        "vendor_id",
        "vendor_name",
        "property_id",
        "property_name",
    }
    assert body[0]["property_name"] == "Elm Court"
    assert body[0]["vendor_id"] == acme["vendor_id"]


def test_lookup_filters_by_the_normalized_account_number(db, account):
    db.add_vendor_account(
        account["property_id"], account["vendor_id"], account_number="2000456701"
    )

    found = as_user().get("/vendor-accounts", params={"account_number": "2000 4567-00"})

    assert [row["id"] for row in found.json()] == [account["account_id"]]


def test_lookup_returns_every_candidate_or_none(db, account):
    db.add_vendor_account(
        db.add_property("Oak Row")["property_id"],
        account["vendor_id"],
        account_number="2000456700",
    )

    def lookup(number: str) -> list:
        params = {"account_number": number}
        return as_user().get("/vendor-accounts", params=params).json()

    assert len(lookup("2000456700")) == 2
    assert lookup("9999") == []
    assert lookup("--") == []


# GET /bills/dashboard


def test_the_dashboard_names_the_matched_vendor_and_property(db, account):
    create()
    create({**BILL, "account_number_raw": "9999", "vendor_name_raw": "Raw Co"})

    rows = {
        row["vendor_name_raw"]: row for row in as_user().get("/bills/dashboard").json()
    }

    matched, unmatched = rows[None], rows["Raw Co"]
    assert (matched["vendor_name"], matched["property_name"]) == (
        "Alder Creek Landscaping",
        "Elm Court",
    )
    assert (unmatched["vendor_name"], unmatched["property_name"]) == (None, None)

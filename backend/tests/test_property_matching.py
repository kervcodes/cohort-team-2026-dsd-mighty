"""A bill's property: from its vendor account, or else from its address
(property_matching); a matched bill whose address names another property is
flagged.

The route tests run the real routes and repository queries against
FakeSupabase.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole
from backend.services.property_matching import (
    address_names,
    address_words,
    same_property_address,
)

USER = str(uuid4())

ELM_ADDRESS = "125 Industrial Way, Springfield, IL 62701"
OAK_ADDRESS = "40 Oak Row, Dallas, TX 75201"

BILL = {
    "account_number_raw": "2000-4567 00",
    "invoice_number": "INV-1",
    "invoice_date": "2026-11-01",
    "due_date": "2026-12-01",
    "amount": "250.00",
}


# The rule.


@pytest.mark.parametrize(
    ("address", "words"),
    [
        ("12 Elm Street", ["12", "elm", "st"]),
        ("12 ELM ST.", ["12", "elm", "st"]),
        ("400 North Main Avenue, Suite 5", ["400", "n", "main", "ave", "ste", "5"]),
        ("  ", []),
    ],
)
def test_address_words_are_lowercased_and_shortened(address, words):
    assert address_words(address) == words


@pytest.mark.parametrize(
    "address",
    [
        ELM_ADDRESS,
        "125 Industrial Way",
        "125 INDUSTRIAL WAY SPRINGFIELD IL 62701-4410",
        "Elm Court Apartments, 125 Industrial Way, Springfield, IL 62701",
        "125 Industrial Way, Suite 10001, Springfield, IL 62701",
    ],
)
def test_an_address_names_the_property_on_its_street_and_zip(address):
    assert address_names(address, "125 Industrial Way", "62701")


@pytest.mark.parametrize(
    "address",
    [
        "125 Industrial Way, Springfield, IL 62702",
        "1250 Industrial Way, Springfield, IL 62701",
        "125 Industrial Road, Springfield, IL 62701",
        "Springfield, IL 62701",
        "",
    ],
)
def test_an_address_on_another_street_or_zip_names_nothing(address):
    assert not address_names(address, "125 Industrial Way", "62701")


def test_written_out_and_short_street_words_are_the_same():
    assert address_names("12 Elm Street, Dallas, TX 75201", "12 Elm St", "75201")
    assert address_names("12 Elm St, Dallas, TX 75201", "12 Elm Street", "75201-1234")


@pytest.mark.parametrize("address", [None, "", " , "])
def test_an_address_with_no_letters_or_digits_names_no_property(address):
    properties = [{"street": "1 Main St", "zip_code": "75201"}]

    assert same_property_address(properties, address) == []


# Every write path.


@pytest.fixture
def db():
    fake = FakeSupabase()
    fake.add_user(USER)
    with patch("backend.api.bills.get_admin_supabase", return_value=fake):
        yield fake


@pytest.fixture
def elm(db):
    return db.add_property(
        "Elm Court", street="125 Industrial Way", city="Springfield", zip_code="62701"
    )


@pytest.fixture
def oak(db):
    return db.add_property("Oak Row", street="40 Oak Row", zip_code="75201")


@pytest.fixture
def account(db, oak):
    """An active account at Oak Row with BILL's number."""
    vendor = db.add_vendor("Alder Creek Landscaping")
    return db.add_vendor_account(
        oak["property_id"], vendor["vendor_id"], account_number="2000456700"
    )


def client() -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: make_user(
        USER, role=UserRole.analyst
    )
    return TestClient(app)


def write(db, path: str, body: dict) -> dict:
    """Send `body` down one write path; return the bill row it wrote."""
    if path == "create":
        response = client().post("/bills", json=body)
    elif path == "draft":
        response = client().post("/bills/drafts", json=body)
    elif path == "resubmit":
        bill_id = db.add_bill(USER, status="rejected")["bill_id"]
        db.add_approval(bill_id, approval_status="rejected")
        response = client().post(f"/bills/{bill_id}/resubmit", json=body)
    else:
        bill_id = db.add_bill(USER)["bill_id"]
        if path == "update":
            response = client().patch(f"/bills/{bill_id}/draft", json=body)
        else:
            response = client().post(f"/bills/{bill_id}/submit", json=body)
    assert response.status_code in (200, 201), response.text
    return db.tables["bills"][-1]


WRITE_PATHS = ["create", "draft", "update", "submit", "resubmit"]

UNMATCHED_NUMBER = {**BILL, "account_number_raw": "9999"}


def match_of(row: dict) -> tuple:
    return (
        row.get("vendor_account_id"),
        row.get("vendor_id"),
        row.get("property_id"),
        row.get("property_address_mismatch"),
    )


# No vendor account: the address finds the property.


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_an_unmatched_bill_gets_the_property_its_address_names(db, elm, oak, path):
    row = write(db, path, {**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})

    assert match_of(row) == (None, None, elm["property_id"], False)


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_an_address_naming_several_properties_finds_none(db, elm, path):
    db.add_property("Elm Court East", street="125 Industrial Way", zip_code="62701")

    row = write(db, path, {**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})

    assert match_of(row) == (None, None, None, False)


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_inactive_properties_are_ignored(db, elm, path):
    db.add_property(
        "Old Elm Court",
        street="125 Industrial Way",
        zip_code="62701",
        status="inactive",
    )

    row = write(db, path, {**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})

    assert match_of(row) == (None, None, elm["property_id"], False)


@pytest.mark.parametrize("path", WRITE_PATHS)
@pytest.mark.parametrize("address", [None, "1 Nowhere Ln, Austin, TX 78701"])
def test_no_address_or_an_unknown_one_finds_no_property(db, elm, path, address):
    body = {**UNMATCHED_NUMBER, "property_address": address}

    row = write(db, path, body)

    assert match_of(row) == (None, None, None, False)


# A vendor account: its property wins, and a disagreeing address is flagged.


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_a_matched_bill_naming_another_property_is_flagged(db, elm, account, path):
    row = write(db, path, {**BILL, "property_address": ELM_ADDRESS})

    assert match_of(row) == (
        account["account_id"],
        account["vendor_id"],
        account["property_id"],
        True,
    )


@pytest.mark.parametrize("path", WRITE_PATHS)
@pytest.mark.parametrize("address", [None, OAK_ADDRESS])
def test_a_matched_bill_naming_its_property_or_nothing_is_not_flagged(
    db, elm, account, path, address
):
    body = {**BILL} if address is None else {**BILL, "property_address": address}

    row = write(db, path, body)

    assert match_of(row)[2:] == (account["property_id"], False)


@pytest.mark.parametrize("path", WRITE_PATHS)
def test_a_picked_account_is_flagged_too(db, elm, account, path):
    body = {
        **UNMATCHED_NUMBER,
        "vendor_account_id": account["account_id"],
        "property_address": ELM_ADDRESS,
    }

    row = write(db, path, body)

    assert row["vendor_account_picked"] is True
    assert match_of(row)[2:] == (account["property_id"], True)


# Draft updates are partial.


def save_draft(body: dict) -> str:
    response = client().post("/bills/drafts", json=body)
    assert response.status_code == 201, response.text
    return response.json()["bill_id"]


def patch_draft(bill_id: str, body: dict) -> None:
    response = client().patch(f"/bills/{bill_id}/draft", json=body)
    assert response.status_code == 200, response.text


def test_a_new_address_alone_finds_the_property_again(db, elm, oak):
    draft_id = save_draft({**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})

    patch_draft(draft_id, {"property_address": OAK_ADDRESS})

    (row,) = db.tables["bills"]
    assert match_of(row) == (None, None, oak["property_id"], False)


def test_a_new_number_alone_keeps_using_the_stored_address(db, elm, account):
    draft_id = save_draft({**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})
    (row,) = db.tables["bills"]
    assert match_of(row)[2:] == (elm["property_id"], False)

    patch_draft(draft_id, {"account_number_raw": BILL["account_number_raw"]})

    assert match_of(row) == (
        account["account_id"],
        account["vendor_id"],
        account["property_id"],
        True,
    )


def test_a_new_address_on_a_picked_draft_keeps_the_pick_and_flags_it(db, elm, account):
    draft_id = save_draft(
        {**BILL, "vendor_account_id": account["account_id"], "property_address": None}
    )
    (row,) = db.tables["bills"]
    assert row["property_address_mismatch"] is False

    patch_draft(draft_id, {"property_address": ELM_ADDRESS})

    assert row["vendor_account_picked"] is True
    assert match_of(row)[2:] == (account["property_id"], True)

    patch_draft(draft_id, {"property_address": OAK_ADDRESS})

    assert match_of(row)[2:] == (account["property_id"], False)


def test_an_update_without_the_address_keeps_the_found_property(db, elm):
    draft_id = save_draft({**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})

    patch_draft(draft_id, {"amount": "300.00"})

    (row,) = db.tables["bills"]
    assert match_of(row) == (None, None, elm["property_id"], False)


def test_a_property_added_since_is_found_on_the_next_save(db):
    draft_id = save_draft({**UNMATCHED_NUMBER, "property_address": ELM_ADDRESS})
    (row,) = db.tables["bills"]
    assert row["property_id"] is None
    elm = db.add_property("Elm Court", street="125 Industrial Way", zip_code="62701")

    patch_draft(draft_id, {"amount": "300.00"})

    assert row["property_id"] == elm["property_id"]


# Reads.


def test_reads_return_the_flag(db, elm, account):
    created = (
        client().post("/bills", json={**BILL, "property_address": ELM_ADDRESS}).json()
    )
    draft_id = save_draft(
        {**BILL, "invoice_number": "INV-2", "property_address": ELM_ADDRESS}
    )

    assert created["property_address_mismatch"] is True
    assert client().get(f"/bills/{created['id']}").json()["property_address_mismatch"]
    draft = client().get(f"/bills/{draft_id}/draft").json()
    assert draft["property_address_mismatch"] is True


def test_the_dashboard_names_the_found_property_and_the_flag(db, elm, account):
    client().post("/bills", json={**BILL, "property_address": ELM_ADDRESS})
    client().post(
        "/bills",
        json={
            **UNMATCHED_NUMBER,
            "vendor_name_raw": "Raw Co",
            "property_address": ELM_ADDRESS,
        },
    )

    rows = {
        row["vendor_name_raw"]: row for row in client().get("/bills/dashboard").json()
    }

    flagged, found = rows[None], rows["Raw Co"]
    assert (flagged["property_name"], flagged["property_address_mismatch"]) == (
        "Oak Row",
        True,
    )
    assert (found["property_name"], found["property_address_mismatch"]) == (
        "Elm Court",
        False,
    )

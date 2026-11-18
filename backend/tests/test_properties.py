"""GET /properties reads `public.properties` through the repository, POST
/properties adds one, GET /properties/{id} reads one and PATCH changes one.

Who may call them is checked in test_route_permissions.py; these tests cover
what they do for a caller who is allowed.
"""

from unittest.mock import patch
from uuid import UUID

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.properties.get_admin_supabase", return_value=fake):
        yield fake


@pytest.fixture
def analyst():
    app.dependency_overrides[get_current_user] = lambda: make_user(
        role=UserRole.analyst
    )
    return TestClient(app)


def names(response) -> list[str]:
    return [item["property_name"] for item in response.json()["items"]]


def test_list_requires_sign_in(db):
    response = TestClient(app).get("/properties")

    assert response.status_code == 401


def test_list_returns_properties_sorted_by_name_with_api_field_names(db, analyst):
    oak = db.add_property(
        "Oak Plaza",
        street="9 Oak Ave",
        city="Austin",
        state="TX",
        zip_code="73301-0001",
        status="inactive",
    )
    db.add_property("Elm Court")

    response = analyst.get("/properties")

    assert response.status_code == 200
    body = response.json()
    assert names(response) == ["Elm Court", "Oak Plaza"]
    assert body["items"][1] == {
        "id": oak["property_id"],
        "property_name": "Oak Plaza",
        "address": {
            "street": "9 Oak Ave",
            "city": "Austin",
            "state": "TX",
            "zip_code": "73301-0001",
        },
        "status": "inactive",
        "created_at": oak["created_at"].replace("+00:00", "Z"),
    }
    assert (body["total"], body["skip"], body["limit"]) == (2, 0, 25)


def test_list_is_empty_when_there_are_no_properties(db, analyst):
    response = analyst.get("/properties")

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "skip": 0, "limit": 25}


def test_list_pages_with_skip_and_limit_and_counts_every_property(db, analyst):
    for name in ("A", "B", "C", "D", "E"):
        db.add_property(name)

    response = analyst.get("/properties", params={"skip": 1, "limit": 2})

    assert response.status_code == 200
    assert names(response) == ["B", "C"]
    assert response.json()["total"] == 5


def test_paging_across_a_shared_name_returns_each_property_once(db, analyst):
    second = db.add_property("Elm Court", property_id=str(UUID(int=2)))
    first = db.add_property("Elm Court", property_id=str(UUID(int=1)))

    pages = [
        analyst.get("/properties", params={"skip": skip, "limit": 1}).json()["items"]
        for skip in (0, 1)
    ]

    assert [item["id"] for page in pages for item in page] == [
        first["property_id"],
        second["property_id"],
    ]


def test_a_page_past_the_end_is_empty_not_an_error(db, analyst):
    db.add_property("A")
    db.add_property("B")

    response = analyst.get("/properties", params={"skip": 5})

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 2, "skip": 5, "limit": 25}


def test_name_keeps_properties_whose_name_contains_it_ignoring_case(db, analyst):
    for name in ("Elm Court", "Oak Plaza", "Elmwood Terrace"):
        db.add_property(name)

    response = analyst.get("/properties", params={"name": "ELM"})

    assert names(response) == ["Elm Court", "Elmwood Terrace"]
    assert response.json()["total"] == 2


@pytest.mark.parametrize("name", ["100%", "Unit_1"])
def test_name_matches_like_wildcards_literally(db, analyst, name):
    db.add_property("100% Occupied")
    db.add_property("1000 Main")
    db.add_property("Unit_1 Lofts")
    db.add_property("Unit-1 Lofts")

    response = analyst.get("/properties", params={"name": name})

    assert len(names(response)) == 1
    assert names(response)[0].startswith(name)


@pytest.mark.parametrize(
    "params",
    [{"skip": -1}, {"limit": 0}, {"limit": 101}, {"name": ""}],
)
def test_bad_paging_or_empty_name_is_422(db, analyst, params):
    response = analyst.get("/properties", params=params)

    assert response.status_code == 422


# POST /properties


@pytest.fixture
def admin():
    app.dependency_overrides[get_current_user] = lambda: make_user(role=UserRole.admin)
    return TestClient(app)


NEW_PROPERTY = {
    "property_name": "Oak Row",
    "address": {
        "street": "40 Oak Row",
        "city": "Dallas",
        "state": "TX",
        "zip_code": "75201",
    },
}


def test_create_stores_the_address_in_flat_columns_and_returns_it_nested(db, admin):
    response = admin.post("/properties", json=NEW_PROPERTY)

    assert response.status_code == 201, response.text
    body = response.json()
    (row,) = db.tables["properties"]
    assert body == {
        **NEW_PROPERTY,
        "id": row["property_id"],
        "status": "active",
        "created_at": row["created_at"].replace("+00:00", "Z"),
    }
    assert (row["street"], row["city"], row["state"], row["zip_code"]) == (
        "40 Oak Row",
        "Dallas",
        "TX",
        "75201",
    )
    assert row["status"] == "active"


def test_create_trims_and_uppercases_the_state(db, admin):
    body = {
        "property_name": "  Oak Row ",
        "status": "inactive",
        "address": {
            "street": " 40 Oak Row ",
            "city": "Dallas",
            "state": "tx",
            "zip_code": "75201-1234",
        },
    }

    response = admin.post("/properties", json=body)

    assert response.status_code == 201, response.text
    (row,) = db.tables["properties"]
    assert (row["property_name"], row["street"], row["state"], row["status"]) == (
        "Oak Row",
        "40 Oak Row",
        "TX",
        "inactive",
    )
    assert row["zip_code"] == "75201-1234"


def test_a_created_property_is_listed(db, admin):
    admin.post("/properties", json=NEW_PROPERTY)

    assert names(admin.get("/properties")) == ["Oak Row"]


@pytest.mark.parametrize(
    "change",
    [
        {"property_name": ""},
        {"property_name": "x" * 201},
        {"address": {**NEW_PROPERTY["address"], "state": "T1"}},
        {"address": {**NEW_PROPERTY["address"], "state": "Texas"}},
        {"address": {**NEW_PROPERTY["address"], "zip_code": "7520"}},
        {"address": {**NEW_PROPERTY["address"], "zip_code": "75201-12"}},
        {"address": {**NEW_PROPERTY["address"], "street": " "}},
        {"status": "closed"},
        {"property_id": "11111111-1111-4111-8111-111111111111"},
    ],
)
def test_create_rejects_a_bad_body_with_422_and_stores_nothing(db, admin, change):
    response = admin.post("/properties", json={**NEW_PROPERTY, **change})

    assert response.status_code == 422
    assert db.tables.get("properties", []) == []


# GET /properties/{id}

MISSING_ID = "11111111-1111-4111-8111-111111111111"


def test_get_returns_one_property_with_api_field_names(db, analyst):
    oak = db.add_property("Oak Plaza", street="9 Oak Ave", zip_code="73301")

    response = analyst.get(f"/properties/{oak['property_id']}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == oak["property_id"]
    assert body["property_name"] == "Oak Plaza"
    assert body["address"]["street"] == "9 Oak Ave"
    assert body["address"]["zip_code"] == "73301"


def test_get_an_unknown_property_is_404(db, analyst):
    response = analyst.get(f"/properties/{MISSING_ID}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Property not found."


def test_get_a_malformed_id_is_422(db, analyst):
    assert analyst.get("/properties/not-a-uuid").status_code == 422


# PATCH /properties/{id}


def test_patch_changes_only_the_fields_sent(db, admin):
    oak = db.add_property("Oak Plaza", street="9 Oak Ave", city="Austin")

    response = admin.patch(
        f"/properties/{oak['property_id']}", json={"property_name": "  Oak Court "}
    )

    assert response.status_code == 200, response.text
    assert response.json()["property_name"] == "Oak Court"
    (row,) = db.tables["properties"]
    assert (row["property_name"], row["street"], row["city"], row["status"]) == (
        "Oak Court",
        "9 Oak Ave",
        "Austin",
        "active",
    )


def test_patch_replaces_the_whole_address_in_flat_columns(db, admin):
    oak = db.add_property("Oak Plaza")
    address = {
        "street": " 12 Elm St ",
        "city": "Plano",
        "state": "tx",
        "zip_code": "75024-1234",
    }

    response = admin.patch(
        f"/properties/{oak['property_id']}", json={"address": address}
    )

    assert response.status_code == 200, response.text
    assert response.json()["address"] == {
        "street": "12 Elm St",
        "city": "Plano",
        "state": "TX",
        "zip_code": "75024-1234",
    }
    (row,) = db.tables["properties"]
    assert (row["street"], row["city"], row["state"], row["zip_code"]) == (
        "12 Elm St",
        "Plano",
        "TX",
        "75024-1234",
    )


def test_patch_deactivates_and_reactivates(db, admin):
    oak = db.add_property("Oak Plaza")
    url = f"/properties/{oak['property_id']}"

    assert admin.patch(url, json={"status": "inactive"}).json()["status"] == "inactive"
    assert db.tables["properties"][0]["status"] == "inactive"
    assert admin.patch(url, json={"status": "active"}).json()["status"] == "active"
    assert db.tables["properties"][0]["status"] == "active"


def test_a_deactivated_property_is_no_longer_matched_by_address(db, admin):
    from backend.services.property_matching import property_for_address

    oak = db.add_property("Oak Plaza", street="9 Oak Ave", zip_code="75201")
    address = "9 Oak Ave, Dallas, TX 75201"
    assert property_for_address(db, address) == oak["property_id"]

    admin.patch(f"/properties/{oak['property_id']}", json={"status": "inactive"})

    assert property_for_address(db, address) is None


def test_patch_an_unknown_property_is_404(db, admin):
    response = admin.patch(f"/properties/{MISSING_ID}", json={"status": "inactive"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Property not found."


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"property_name": None},
        {"address": None},
        {"status": None},
        {"property_name": ""},
        {"property_name": "x" * 201},
        {"status": "closed"},
        {"address": {**NEW_PROPERTY["address"], "state": "Texas"}},
        {"address": {**NEW_PROPERTY["address"], "zip_code": "7520"}},
        {"address": {"street": "1 Main St"}},
        {"property_id": MISSING_ID},
        {"created_at": "2026-01-01T00:00:00Z"},
    ],
)
def test_patch_rejects_a_bad_body_with_422_and_changes_nothing(db, admin, body):
    oak = db.add_property("Oak Plaza")
    before = dict(db.tables["properties"][0])

    response = admin.patch(f"/properties/{oak['property_id']}", json=body)

    assert response.status_code == 422
    assert db.tables["properties"][0] == before

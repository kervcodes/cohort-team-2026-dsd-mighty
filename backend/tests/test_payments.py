"""Recording and listing payments: `POST` and `GET /bills/{bill_id}/payments`.

The routes run against FakeSupabase, whose `record_payment` mirrors the
Postgres function (backend/supabase/migrations/20261115120000_record_payment.sql,
tested in backend/supabase/tests/record_payment.test.sql). Who may call each
route at all is checked by the role table in test_route_permissions.py.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fake_supabase import FakeSupabase
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from backend.app import app
from backend.auth import get_current_user
from backend.schemas.user import UserRole

ANALYST = str(uuid4())
APPROVER = str(uuid4())

COMPLETED = {
    "amount": "120.50",
    "payment_method": "ach",
    "paid_on": "2026-11-14",
    "reference": "ACH-123",
    "outcome": "completed",
}
FAILED = {
    "amount": "120.50",
    "payment_method": "credit_card",
    "paid_on": "2026-11-13",
    "outcome": "failed",
    "failure_reason": "Card declined",
}


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch("backend.api.payments.get_admin_supabase", return_value=fake):
        yield fake


def as_user(db: FakeSupabase, user_id: str, role: UserRole) -> TestClient:
    # payments.recorded_by references app_users, as the caller's row does.
    if not db.find("app_users", "user_id", user_id):
        db.add_user(user_id, role=role.value)
    app.dependency_overrides[get_current_user] = lambda: make_user(user_id, role=role)
    return TestClient(app)


def approver(db: FakeSupabase) -> TestClient:
    return as_user(db, APPROVER, UserRole.approver)


def approved_bill(db: FakeSupabase, **fields) -> dict:
    return db.add_bill(ANALYST, status="approved", amount="120.50", **fields)


def pay(client: TestClient, bill: dict, body: dict):
    return client.post(f"/bills/{bill['bill_id']}/payments", json=body)


def payments_of(db: FakeSupabase, bill: dict) -> list[dict]:
    return [p for p in db.tables.get("payments", []) if p["bill_id"] == bill["bill_id"]]


# Recording a completed payment


def test_completed_payment_is_recorded_and_marks_the_bill_paid(db):
    bill = approved_bill(db)

    response = pay(approver(db), bill, COMPLETED)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["id"]
    assert body["created_at"]
    assert {k: v for k, v in body.items() if k not in ("id", "created_at")} == {
        "bill_id": bill["bill_id"],
        "amount": "120.50",
        "payment_method": "ach",
        "payment_status": "completed",
        "paid_on": "2026-11-14",
        "reference": "ACH-123",
        "failure_reason": None,
        "attempt_number": 1,
        "recorded_by": APPROVER,
    }
    assert bill["status"] == "paid"


def test_payment_stores_who_recorded_it(db):
    bill = approved_bill(db)
    admin_id = str(uuid4())

    response = pay(as_user(db, admin_id, UserRole.admin), bill, FAILED)

    assert response.status_code == 201, response.text
    assert response.json()["recorded_by"] == admin_id
    assert [p["recorded_by"] for p in payments_of(db, bill)] == [admin_id]


def test_admin_can_record_a_payment(db):
    bill = approved_bill(db)

    response = pay(as_user(db, str(uuid4()), UserRole.admin), bill, COMPLETED)

    assert response.status_code == 201, response.text
    assert bill["status"] == "paid"


def test_amount_with_fewer_decimals_still_matches(db):
    bill = approved_bill(db)

    response = pay(approver(db), bill, {**COMPLETED, "amount": "120.5"})

    assert response.status_code == 201, response.text
    assert response.json()["amount"] == "120.50"


def test_reference_is_optional(db):
    bill = approved_bill(db)
    body = {k: v for k, v in COMPLETED.items() if k != "reference"}

    response = pay(approver(db), bill, body)

    assert response.status_code == 201, response.text
    assert response.json()["reference"] is None


def test_completed_payment_must_be_for_the_bill_amount(db):
    bill = approved_bill(db)

    response = pay(approver(db), bill, {**COMPLETED, "amount": "100.00"})

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "A completed payment must be for the full bill amount (120.50)."
    )
    assert bill["status"] == "approved"
    assert payments_of(db, bill) == []


# Recording a failed attempt


def test_failed_attempt_is_recorded_and_keeps_the_bill_approved(db):
    bill = approved_bill(db)

    response = pay(approver(db), bill, FAILED)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["payment_status"] == "failed"
    assert body["failure_reason"] == "Card declined"
    assert bill["status"] == "approved"


def test_failed_attempt_need_not_match_the_bill_amount(db):
    bill = approved_bill(db)

    response = pay(approver(db), bill, {**FAILED, "amount": "50.00"})

    assert response.status_code == 201, response.text


def test_attempt_numbers_increase(db):
    bill = approved_bill(db)
    client = approver(db)

    attempts = [
        pay(client, bill, body).json()["attempt_number"]
        for body in (FAILED, FAILED, COMPLETED)
    ]

    assert attempts == [1, 2, 3]
    assert bill["status"] == "paid"


def test_attempt_numbers_count_per_bill(db):
    first, second = approved_bill(db), approved_bill(db)
    client = approver(db)
    pay(client, first, FAILED)

    response = pay(client, second, FAILED)

    assert response.json()["attempt_number"] == 1


# Bills that cannot be paid


def test_unknown_bill_is_404(db):
    response = approver(db).post(f"/bills/{uuid4()}/payments", json=COMPLETED)

    assert response.status_code == 404
    assert response.json()["detail"] == "Bill not found."


def test_another_users_draft_is_404_not_409(db):
    # A draft is visible only to its author, so its existence must not leak.
    bill = db.add_bill(ANALYST, status="draft", amount="120.50")

    response = pay(approver(db), bill, COMPLETED)

    assert response.status_code == 404
    assert payments_of(db, bill) == []


@pytest.mark.parametrize(
    ("status", "label"),
    [
        ("pending_approval", "pending approval"),
        ("rejected", "rejected"),
        ("exception", "exception"),
    ],
)
def test_bill_that_is_not_approved_is_409(db, status, label):
    bill = db.add_bill(ANALYST, status=status, amount="120.50")

    response = pay(approver(db), bill, COMPLETED)

    assert response.status_code == 409
    assert response.json()["detail"] == (
        f"Only approved bills can be paid. This bill is {label}."
    )
    assert bill["status"] == status
    assert payments_of(db, bill) == []


def test_failed_attempt_on_a_bill_that_is_not_approved_is_409(db):
    bill = db.add_bill(ANALYST, status="pending_approval", amount="120.50")

    response = pay(approver(db), bill, FAILED)

    assert response.status_code == 409
    assert payments_of(db, bill) == []


def test_paying_a_paid_bill_again_is_409_and_records_nothing(db):
    # Two people marking the same bill paid: the second is told, and only one
    # payment exists. Postgres serialises them with the bill's row lock.
    bill = approved_bill(db)
    assert pay(approver(db), bill, COMPLETED).status_code == 201

    response = pay(as_user(db, str(uuid4()), UserRole.admin), bill, COMPLETED)

    assert response.status_code == 409
    assert response.json()["detail"] == "This bill has already been paid."
    assert [p["payment_status"] for p in payments_of(db, bill)] == ["completed"]


# Nulls never read as a match. The bills constraints keep these bills out of
# a real database, so the route cannot reach them; this calls the
# record_payment twin directly, as record_payment.test.sql section 8 calls
# the function.


def record_payment_params(bill: dict, **overrides) -> dict:
    return {
        "p_bill_id": bill["bill_id"],
        "p_amount": "60.00",
        "p_payment_method": "ach",
        "p_paid_on": "2026-11-14",
        "p_provider_reference": None,
        "p_payment_status": "completed",
        "p_failure_reason": None,
        "p_recorded_by": APPROVER,
        **overrides,
    }


@pytest.mark.parametrize(
    ("bill_fields", "overrides", "code", "details"),
    [
        pytest.param(
            {"status": None, "amount": "60.00"},
            {},
            "PT409",
            "",
            id="bill with no status",
        ),
        pytest.param(
            {"status": None, "amount": "60.00"},
            {"p_payment_status": "failed", "p_failure_reason": "Card declined"},
            "PT409",
            "",
            id="failed attempt on a bill with no status",
        ),
        pytest.param(
            {"status": "approved", "amount": None},
            {},
            "PT422",
            "",
            id="bill with no amount",
        ),
        pytest.param(
            {"status": "approved", "amount": "60.00"},
            {"p_amount": None},
            "PT422",
            "60.00",
            id="payment with no amount",
        ),
    ],
)
def test_null_status_or_amount_is_refused_and_records_nothing(
    db, bill_fields, overrides, code, details
):
    db.add_user(APPROVER, role="approver")
    bill = db.add_bill(ANALYST, **bill_fields)

    with pytest.raises(APIError) as refused:
        db.rpc("record_payment", record_payment_params(bill, **overrides)).execute()

    assert (refused.value.code, refused.value.details) == (code, details)
    assert bill["status"] == bill_fields["status"]
    assert payments_of(db, bill) == []


def test_bill_with_no_amount_is_422_and_records_nothing(db):
    bill = db.add_bill(ANALYST, status="approved", amount=None)

    response = pay(approver(db), bill, COMPLETED)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "This bill has no amount, so it can't be marked paid."
    )
    assert bill["status"] == "approved"
    assert payments_of(db, bill) == []


@pytest.mark.parametrize(
    "details",
    [
        pytest.param("", id="null status"),
        pytest.param("scheduled", id="status the API does not know"),
    ],
)
def test_bill_in_a_status_the_api_does_not_know_is_409(db, details):
    # The bill read before the payment cannot hold such a status, so the
    # function's refusal is patched in.
    bill = approved_bill(db)

    def refuse(_db: FakeSupabase, **_params: object) -> None:
        raise APIError({"code": "PT409", "message": "Not approved", "details": details})

    with patch.object(FakeSupabase, "_rpc_record_payment", refuse):
        response = pay(approver(db), bill, COMPLETED)

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "This bill can't be paid in its current state."
    )
    assert payments_of(db, bill) == []


# Request validation


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({**COMPLETED, "amount": "0"}, id="zero amount"),
        pytest.param({**COMPLETED, "amount": "-1.00"}, id="negative amount"),
        pytest.param({**COMPLETED, "amount": "120.505"}, id="three decimals"),
        pytest.param({**COMPLETED, "payment_method": "cash"}, id="unknown method"),
        pytest.param({**COMPLETED, "reference": "x" * 201}, id="long reference"),
        pytest.param({**COMPLETED, "outcome": "pending"}, id="pending outcome"),
        pytest.param(
            {**COMPLETED, "failure_reason": "Declined"},
            id="completed with failure reason",
        ),
        pytest.param(
            {k: v for k, v in FAILED.items() if k != "failure_reason"},
            id="failed without failure reason",
        ),
        pytest.param({**FAILED, "failure_reason": "   "}, id="blank failure reason"),
        pytest.param({**COMPLETED, "payment_status": "completed"}, id="extra field"),
        pytest.param(
            {k: v for k, v in COMPLETED.items() if k != "paid_on"}, id="no date"
        ),
    ],
)
def test_invalid_request_is_422_and_records_nothing(db, body):
    bill = approved_bill(db)

    response = pay(approver(db), bill, body)

    assert response.status_code == 422, response.text
    assert bill["status"] == "approved"
    assert payments_of(db, bill) == []


def days_after_utc_today(days: int) -> str:
    # Computed when the test runs, so a run that crosses midnight stays right.
    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


@pytest.mark.parametrize("days", [0, 1])
def test_payment_dated_today_anywhere_is_accepted(db, days):
    # At UTC+14 the local date is already one day after the UTC date.
    bill = approved_bill(db)

    response = pay(
        approver(db), bill, {**COMPLETED, "paid_on": days_after_utc_today(days)}
    )

    assert response.status_code == 201, response.text


def test_payment_dated_after_tomorrow_in_utc_is_422(db):
    # Later than today in every time zone.
    bill = approved_bill(db)

    response = pay(
        approver(db), bill, {**COMPLETED, "paid_on": days_after_utc_today(2)}
    )

    assert response.status_code == 422
    assert "can't be in the future" in response.text
    assert payments_of(db, bill) == []


# Listing


def test_list_is_newest_first(db):
    bill = approved_bill(db)
    client = approver(db)
    for body in (FAILED, FAILED, COMPLETED):
        pay(client, bill, body)

    response = client.get(f"/bills/{bill['bill_id']}/payments")

    assert response.status_code == 200, response.text
    assert [p["attempt_number"] for p in response.json()] == [3, 2, 1]
    assert [p["payment_status"] for p in response.json()] == [
        "completed",
        "failed",
        "failed",
    ]


def test_list_only_has_this_bills_payments(db):
    bill, other = approved_bill(db), approved_bill(db)
    pay(approver(db), other, FAILED)

    response = approver(db).get(f"/bills/{bill['bill_id']}/payments")

    assert response.status_code == 200
    assert response.json() == []


def test_analyst_can_list_payments_of_any_submitted_bill(db):
    bill = approved_bill(db)
    pay(approver(db), bill, COMPLETED)

    response = as_user(db, str(uuid4()), UserRole.analyst).get(
        f"/bills/{bill['bill_id']}/payments"
    )

    assert response.status_code == 200
    assert [p["payment_status"] for p in response.json()] == ["completed"]


def test_analyst_cannot_list_payments_of_another_users_draft(db):
    bill = db.add_bill(ANALYST, status="draft")

    response = as_user(db, str(uuid4()), UserRole.analyst).get(
        f"/bills/{bill['bill_id']}/payments"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Bill not found."


def test_author_can_list_payments_of_their_own_draft(db):
    bill = db.add_bill(ANALYST, status="draft")

    response = as_user(db, ANALYST, UserRole.analyst).get(
        f"/bills/{bill['bill_id']}/payments"
    )

    assert response.status_code == 200
    assert response.json() == []


def test_list_for_unknown_bill_is_404(db):
    response = approver(db).get(f"/bills/{uuid4()}/payments")

    assert response.status_code == 404

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, status

from backend.schemas.payment import PaymentCreate, PaymentRead

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post(
    "/bill/{bill_id}/pay",
    response_model=PaymentRead,
    status_code=status.HTTP_201_CREATED,
)
def pay_bill(bill_id: UUID, payment: PaymentCreate) -> PaymentRead:
    new_payment = PaymentRead(
        **payment.model_dump(),
        id=uuid4(),
        timestamp=datetime.now(UTC),
    )

    return new_payment


@router.get("/bill/{bill_id}", response_model=list[PaymentRead])
def list_payments_for_bill(bill_id: UUID) -> list[PaymentRead]:
    return []


@router.get("/payments", response_model=list[PaymentRead])
def list_all_payments() -> list[PaymentRead]:
    return []


@router.get("/payments/{payment_id}", response_model=PaymentRead)
def get_payment(payment_id: UUID) -> PaymentRead:
    return []

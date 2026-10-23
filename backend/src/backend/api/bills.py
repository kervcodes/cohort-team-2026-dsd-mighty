from datetime import UTC, datetime
from http.client import HTTPException
from uuid import UUID, uuid4

from fastapi import APIRouter, status

from backend.schemas.bill import BillCreate, BillRead, BillStatus
from backend.schemas.user import UserSummary

router = APIRouter(
    prefix="/bills",
    tags=["bills"],
)

_bills: list[BillRead] = []


@router.post("", response_model=BillRead, status_code=status.HTTP_201_CREATED)
def create_bill(bill: BillCreate) -> BillRead:
    new_bill = BillRead(
        **bill.model_dump(),
        id=uuid4(),
        submitted_by=UserSummary(
            id=uuid4(),
            full_name="Demo User",
        ),
        status=BillStatus.draft,
        created_at=datetime.now(UTC),
    )

    _bills.append(new_bill)
    return new_bill


@router.get("", response_model=list[BillRead])
def list_bills() -> list[BillRead]:
    return _bills


@router.get("/{bill_id}", response_model=BillRead)
def get_bill(bill_id: UUID) -> BillRead:
    for bill in _bills:
        if bill.id == bill_id:
            return bill
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Bill not found.",
    )

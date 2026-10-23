from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status

from backend.schemas.vendor_account import (
    VendorAccountCreate,
    VendorAccountRead,
    VendorAccountUpdate,
)

router = APIRouter(
    prefix="/vendor-accounts",
    tags=["vendor accounts"],
)

vendor_accounts: dict[UUID, VendorAccountRead] = {}


@router.post(
    "",
    response_model=VendorAccountRead,
    status_code=status.HTTP_201_CREATED,
)
def create_vendor_account(account: VendorAccountCreate):

    for existing in vendor_accounts.values():
        if (
            existing.property_id == account.property_id
            and existing.vendor_id == account.vendor_id
            and existing.account_number == account.account_number
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This vendor account already exists for the property.",
            )

    account_id = uuid4()

    new_account = VendorAccountRead(
        id=account_id,
        property_id=account.property_id,
        vendor_id=account.vendor_id,
        account_number=account.account_number,
        account_type=account.account_type,
        payment_method=account.payment_method,
        portal_url=account.portal_url,
        status=account.status,
        created_at=datetime.now(UTC),
    )

    vendor_accounts[account_id] = new_account
    return new_account


@router.get("/{account_id}", response_model=VendorAccountRead)
def get_vendor_account(account_id: UUID):
    account = vendor_accounts.get(account_id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor account not found.",
        )

    return account


@router.patch("/{account_id}", response_model=VendorAccountRead)
def update_vendor_account(
    account_id: UUID,
    updates: VendorAccountUpdate,
):
    account = vendor_accounts.get(account_id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor account not found.",
        )

    update_data = updates.model_dump(exclude_unset=True)

    updated_account = account.model_copy(update=update_data)
    vendor_accounts[account_id] = updated_account

    return updated_account

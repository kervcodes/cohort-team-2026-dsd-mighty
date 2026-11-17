from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import VENDOR_READERS, VENDOR_WRITERS, require_active
from backend.schemas.vendor_account import (
    VendorAccountCreate,
    VendorAccountOption,
    VendorAccountRead,
    VendorAccountUpdate,
)
from backend.services import vendor_account_repository, vendor_repository
from backend.services.vendor_account_matching import same_account_number
from backend.services.vendor_account_repository import (
    DuplicateVendorAccount,
    UnknownReference,
)
from backend.supabase_client import get_admin_supabase

router = APIRouter(tags=["vendor accounts"])

DUPLICATE_DETAIL = "This vendor account already exists for the property."
NOT_FOUND_DETAIL = "Vendor account not found."


@router.get(
    "/vendors/{vendor_id}/accounts",
    response_model=list[VendorAccountRead],
    dependencies=[Depends(require_active(*VENDOR_READERS))],
)
def list_vendor_accounts(vendor_id: UUID) -> list[dict]:
    client = get_admin_supabase()

    # An unknown vendor is a 404, not an empty list that looks like "no
    # accounts yet".
    if vendor_repository.get_vendor(client, vendor_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor not found.",
        )

    return vendor_account_repository.list_accounts_for_vendor(client, vendor_id)


@router.get(
    "/vendor-accounts",
    response_model=list[VendorAccountOption],
    dependencies=[Depends(require_active(*VENDOR_READERS))],
)
def list_active_vendor_accounts(
    account_number: str | None = Query(default=None, max_length=100),
) -> list[dict]:
    """Active accounts with their vendor's and property's names, for the bill
    form. `account_number` keeps only the accounts a bill with that number
    matches, by the rule bills are matched with."""
    accounts = vendor_account_repository.list_active_account_options(
        get_admin_supabase()
    )

    if account_number is None:
        return accounts
    return same_account_number(accounts, account_number)


@router.post(
    "/vendor-accounts",
    response_model=VendorAccountRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_active(*VENDOR_WRITERS))],
)
def create_vendor_account(account: VendorAccountCreate) -> dict:
    try:
        return vendor_account_repository.create_account(get_admin_supabase(), account)
    except UnknownReference as error:
        # The URL is fine; the body names something that does not exist.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except DuplicateVendorAccount as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DUPLICATE_DETAIL,
        ) from error


@router.get(
    "/vendor-accounts/{account_id}",
    response_model=VendorAccountRead,
    dependencies=[Depends(require_active(*VENDOR_READERS))],
)
def get_vendor_account(account_id: UUID) -> dict:
    account = vendor_account_repository.get_account(get_admin_supabase(), account_id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=NOT_FOUND_DETAIL,
        )

    return account


@router.patch(
    "/vendor-accounts/{account_id}",
    response_model=VendorAccountRead,
    dependencies=[Depends(require_active(*VENDOR_WRITERS))],
)
def update_vendor_account(account_id: UUID, updates: VendorAccountUpdate) -> dict:
    try:
        account = vendor_account_repository.update_account(
            get_admin_supabase(), account_id, updates
        )
    except DuplicateVendorAccount as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DUPLICATE_DETAIL,
        ) from error

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=NOT_FOUND_DETAIL,
        )

    return account

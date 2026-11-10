from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import VENDOR_READERS, VENDOR_WRITERS, require_active
from backend.schemas.vendor import VendorCreate, VendorRead, VendorUpdate
from backend.services import vendor_repository
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/vendors",
    tags=["vendors"],
)


@router.get(
    "",
    response_model=list[VendorRead],
    dependencies=[Depends(require_active(*VENDOR_READERS))],
)
def list_vendors() -> list[dict]:
    return vendor_repository.list_vendors(get_admin_supabase())


@router.post(
    "",
    response_model=VendorRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_active(*VENDOR_WRITERS))],
)
def create_vendor(vendor: VendorCreate) -> dict:
    return vendor_repository.create_vendor(get_admin_supabase(), vendor)


@router.get(
    "/{vendor_id}",
    response_model=VendorRead,
    dependencies=[Depends(require_active(*VENDOR_READERS))],
)
def get_vendor(vendor_id: UUID) -> dict:
    vendor = vendor_repository.get_vendor(get_admin_supabase(), vendor_id)

    if vendor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor not found.",
        )

    return vendor


@router.patch(
    "/{vendor_id}",
    response_model=VendorRead,
    dependencies=[Depends(require_active(*VENDOR_WRITERS))],
)
def update_vendor(vendor_id: UUID, updates: VendorUpdate) -> dict:
    vendor = vendor_repository.update_vendor(get_admin_supabase(), vendor_id, updates)

    if vendor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor not found.",
        )

    return vendor

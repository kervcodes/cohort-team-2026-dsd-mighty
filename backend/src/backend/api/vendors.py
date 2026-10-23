from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status

from backend.schemas.vendor import VendorCreate, VendorRead, VendorUpdate

router = APIRouter(
    prefix="/vendors",
    tags=["vendors"],
)

vendors: dict[UUID, VendorRead] = {}


@router.post(
    "",
    response_model=VendorRead,
    status_code=status.HTTP_201_CREATED,
)
def create_vendor(vendor: VendorCreate):
    vendor_id = uuid4()

    new_vendor = VendorRead(
        id=vendor_id,
        name=vendor.name,
        contact_email=vendor.contact_email,
        contact_phone=vendor.contact_phone,
        default_payment_method=vendor.default_payment_method,
        created_at=datetime.now(UTC),
    )

    vendors[vendor_id] = new_vendor

    return new_vendor


@router.get("/{vendor_id}", response_model=VendorRead)
def get_vendor(vendor_id: UUID):
    vendor = vendors.get(vendor_id)

    if vendor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor not found.",
        )

    return vendor


@router.patch("/{vendor_id}", response_model=VendorRead)
def update_vendor(vendor_id: UUID, updates: VendorUpdate):
    vendor = vendors.get(vendor_id)

    if vendor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor not found.",
        )

    update_data = updates.model_dump(exclude_unset=True)

    updated_vendor = vendor.model_copy(update=update_data)
    vendors[vendor_id] = updated_vendor

    return updated_vendor

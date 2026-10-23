from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, status

from backend.schemas.property import (
    PagePropertyRead,
    PropertyCreate,
    PropertyRead,
    PropertyUpdate,
)

router = APIRouter(prefix="/properties", tags=["properties"])


@router.get("", response_model=PagePropertyRead)
def list_properties(
    name: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
):

    return {"items": [], "total": len([]), "skip": skip, "limit": limit}


@router.post("", response_model=PropertyRead, status_code=status.HTTP_201_CREATED)
def create_property(property: PropertyCreate):
    new_property = PropertyRead(
        **property.model_dump(),
        id=uuid4(),
    )

    return new_property


@router.get("/{property_id}", response_model=PropertyRead)
def get_property(property_id: UUID):
    if property_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found.",
        )
    return PropertyRead(
        id=property_id,
        name="Sample Property",
        address="123 Main St",
        city="Sample City",
        state="SC",
        zip_code="12345",
    )


@router.patch("/{property_id}", response_model=PropertyRead)
def update_property(property_id: UUID, updates: PropertyUpdate):
    if property_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found.",
        )

    updated_property = PropertyRead(
        id=property_id,
        name=updates.name or "Sample Property",
        address=updates.address or "123 Main St",
        city=updates.city or "Sample City",
        state=updates.state or "SC",
        zip_code=updates.zip_code or "12345",
    )

    return updated_property

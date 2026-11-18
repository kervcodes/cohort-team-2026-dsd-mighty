from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import PROPERTY_READERS, PROPERTY_WRITERS, require_active
from backend.schemas.property import (
    PagePropertyRead,
    PropertyCreate,
    PropertyRead,
    PropertyUpdate,
)
from backend.services import property_repository
from backend.supabase_client import get_admin_supabase

router = APIRouter(prefix="/properties", tags=["properties"])

NOT_FOUND_DETAIL = "Property not found."


@router.get(
    "",
    response_model=PagePropertyRead,
    dependencies=[Depends(require_active(*PROPERTY_READERS))],
)
def list_properties(
    name: str | None = Query(default=None, min_length=1, max_length=200),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
) -> dict:
    items, total = property_repository.list_properties(
        get_admin_supabase(), name=name, skip=skip, limit=limit
    )

    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.post(
    "",
    response_model=PropertyRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_active(*PROPERTY_WRITERS))],
)
def create_property(prop: PropertyCreate) -> dict:
    return property_repository.create_property(get_admin_supabase(), prop)


@router.get(
    "/{property_id}",
    response_model=PropertyRead,
    dependencies=[Depends(require_active(*PROPERTY_READERS))],
)
def get_property(property_id: UUID) -> dict:
    prop = property_repository.get_property(get_admin_supabase(), property_id)

    if prop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL
        )

    return prop


# There is no DELETE: bills and vendor accounts keep their property, so a
# property that is no longer used is made inactive (status), which takes it
# out of property matching and the vendor account form.
@router.patch(
    "/{property_id}",
    response_model=PropertyRead,
    dependencies=[Depends(require_active(*PROPERTY_WRITERS))],
)
def update_property(property_id: UUID, updates: PropertyUpdate) -> dict:
    prop = property_repository.update_property(
        get_admin_supabase(), property_id, updates
    )

    if prop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL
        )

    return prop

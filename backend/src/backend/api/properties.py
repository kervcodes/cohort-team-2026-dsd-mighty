from fastapi import APIRouter, Depends, Query

from backend.auth import PROPERTY_READERS, require_active
from backend.schemas.property import PagePropertyRead
from backend.services import property_repository
from backend.supabase_client import get_admin_supabase

router = APIRouter(prefix="/properties", tags=["properties"])


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

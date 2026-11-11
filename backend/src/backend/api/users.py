from fastapi import APIRouter, Depends, HTTPException, status
from uuid import UUID, uuid4

from backend.auth import CurrentUser, require_active, USER_READERS, USER_EDITORS
from backend.schemas.user import UserRead, UserAdminUpdate
from backend.services.user_repository import get_users, update_user, get_user_by_id
from backend.supabase_client import get_admin_supabase

router = APIRouter(
    prefix="/admin/users",
    tags=["users"],
)

_users: list[UserRead] = []


@router.get("", response_model=list[UserRead])
def list_users(
    _user: CurrentUser = Depends(require_active(*USER_READERS)),
) -> list[UserRead]:
    return get_users(client=get_admin_supabase())


@router.get("/{user_id}", response_model=UserRead)
def get_user(
    user_id: UUID,
    _user: CurrentUser = Depends(require_active(*USER_READERS)),
) -> UserRead:
    user = get_user_by_id(
        client=get_admin_supabase(),
        user_id=str(user_id),
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    return UserRead.model_validate(user)
    
@router.patch("/{user_id}", response_model=UserRead)
def edit_user(
    user_id: UUID,
    draft: UserAdminUpdate,
    current_user: CurrentUser = Depends(
        require_active(*USER_EDITORS)
    ),
) -> UserRead:

    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot edit your own account here. Go to /Settings",
        )

    updated = update_user(
        client=get_admin_supabase(),
        user_to_be_updated_id=str(user_id),
        updater_id=str(current_user.id),
        user_updates=draft,
    )

    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    return UserRead.model_validate(updated)
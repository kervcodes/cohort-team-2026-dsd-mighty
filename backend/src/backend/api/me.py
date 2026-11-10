from fastapi import APIRouter, Depends

from backend.auth import CurrentUser, get_current_user
from backend.schemas.user import MeRead

router = APIRouter(tags=["me"])


# Only get_current_user, not require_active: an inactive user still learns
# their status, so the frontend can show "waiting for approval".
@router.get("/me", response_model=MeRead)
def read_me(user: CurrentUser = Depends(get_current_user)) -> MeRead:
    return user

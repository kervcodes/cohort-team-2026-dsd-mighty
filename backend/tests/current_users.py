"""`CurrentUser` values for route tests. Helpers, not tests.

Route tests override `get_current_user`, not `require_active` (a factory, so
there is no single function to override), so the real role check still runs.
"""

from uuid import UUID, uuid4

from backend.auth import CurrentUser
from backend.schemas.common import ActiveStatus
from backend.schemas.user import UserRole


def make_user(
    user_id: str | UUID | None = None,
    *,
    role: UserRole = UserRole.analyst,
    status: ActiveStatus = "active",
) -> CurrentUser:
    return CurrentUser(
        id=user_id or uuid4(),
        email=f"{role}@example.com",
        full_name=f"Test {role}",
        role=role,
        status=status,
    )

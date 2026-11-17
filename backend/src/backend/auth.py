import logging
from collections.abc import Callable

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase_auth.errors import AuthApiError

from backend.audit_actor import set_actor
from backend.schemas.user import MeRead, UserRole
from backend.supabase_client import get_admin_supabase, get_supabase

logger = logging.getLogger(__name__)

bearer = HTTPBearer(auto_error=False)

# Every 401 names the scheme the client should retry with (RFC 6750).
BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}

# Who may use the vendor routes: everyone reads, only admins add or change.
VENDOR_READERS = (UserRole.analyst, UserRole.approver, UserRole.admin)
VENDOR_WRITERS = (UserRole.admin,)

USER_READERS = (UserRole.admin,)
USER_EDITORS = (UserRole.admin,)


class CurrentUser(MeRead):
    """The signed-in caller: the same fields `GET /me` returns."""


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> CurrentUser:
    """The signed-in caller and their `app_users` profile, active or not."""
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers=BEARER_CHALLENGE,
        )

    try:
        auth_response = get_supabase().auth.get_user(credentials.credentials)
    except AuthApiError as exc:
        # Auth's own failures (500, or 429 rate limiting) also arrive as
        # AuthApiError. They say nothing about the token, so the caller must
        # not be told it is invalid and treated as signed out.
        if exc.status >= 500 or exc.status == 429:
            logger.warning("Supabase Auth failed (%s): %s", exc.status, exc.message)
            raise HTTPException(
                status_code=503,
                detail="Unable to verify account.",
            ) from exc
        # The reason (for example "Invalid API key" from a wrong publishable
        # key) goes to the server log; the token itself never does.
        logger.warning("Supabase Auth rejected the access token: %s", exc.message)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token",
            headers=BEARER_CHALLENGE,
        ) from exc
    except Exception as exc:
        # Supabase Auth unreachable (e.g. httpx.ConnectError,
        # AuthRetryableError): a retryable 503, not an unhandled 500 that the
        # browser reports as "Failed to fetch" (500s carry no CORS headers).
        logger.exception("Supabase Auth token check failed")
        raise HTTPException(
            status_code=503,
            detail="Unable to verify account.",
        ) from exc

    user = auth_response.user if auth_response else None

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token",
            headers=BEARER_CHALLENGE,
        )

    # A database outage must not look like "not authorized" (403) or crash as
    # an unhandled 500: the client gets a clear, retryable 503.
    try:
        result = (
            get_admin_supabase()
            .table("app_users")
            .select("email,full_name,role,status")
            .eq("user_id", str(user.id))
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.exception("app_users lookup failed")
        raise HTTPException(
            status_code=503,
            detail="Unable to verify account.",
        ) from exc

    # maybe_single() returns None (not an empty result) when no row matches.
    row = result.data if result is not None else None

    # The signup trigger creates the row, so a missing one was deleted by an
    # admin. It is never re-created here, so that delete sticks.
    if not isinstance(row, dict):
        raise HTTPException(
            status_code=403,
            detail="Account not found. Contact an admin.",
        )

    return CurrentUser(
        id=user.id,
        email=row["email"],
        full_name=row["full_name"],
        role=row["role"],
        status=row["status"],
    )


async def name_audit_actor(
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Dependency: name the caller as the actor of this request's database
    writes, for the audit trail (see `backend.audit_actor`).

    It is `async` on purpose: it must run in the request's own context. A sync
    dependency runs in a worker thread whose context changes are lost, so the
    route would never see the actor.
    """
    set_actor(user.id)


def require_active(*roles: UserRole) -> Callable[..., CurrentUser]:
    """Dependency: the caller is active and has one of `roles`."""
    allowed = frozenset(roles)

    def active_user_with_role(
        user: CurrentUser = Depends(get_current_user),
        _actor: None = Depends(name_audit_actor),
    ) -> CurrentUser:
        if user.status != "active":
            raise HTTPException(
                status_code=403,
                detail="Your account is waiting for approval.",
            )
        if user.role not in allowed:
            raise HTTPException(
                status_code=403,
                detail="Your role can't do this.",
            )
        return user

    return active_user_with_role

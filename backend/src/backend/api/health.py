import logging
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.schemas.health import HealthRead
from backend.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

# A real table from the migrations. RLS is on and the publishable client has no
# session, so the query returns no rows, but an answer proves PostgREST and the
# database are up.
HEALTH_CHECK_TABLE = "bills"


def _deployed_commit() -> str | None:
    # Render sets this on every deploy; read per request so tests can set it.
    return os.environ.get("RENDER_GIT_COMMIT") or None


# Open on purpose: Render and the team call it without signing in. It must only
# ever use the publishable client, never the admin one.
@router.get(
    "/health",
    response_model=HealthRead,
    responses={503: {"model": HealthRead}},
)
def read_health() -> HealthRead | JSONResponse:
    commit = _deployed_commit()
    try:
        get_supabase().table(HEALTH_CHECK_TABLE).select("bill_id").limit(1).execute()
    except Exception:
        # The details stay in the server log; the response names no host or key.
        logger.exception("Health check database query failed")
        unhealthy = HealthRead(status="error", database="unreachable", commit=commit)
        return JSONResponse(status_code=503, content=unhealthy.model_dump())
    return HealthRead(status="ok", database="ok", commit=commit)

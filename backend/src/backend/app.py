from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.approvals import router as approvals_router
from backend.api.bill_documents import router as bill_documents_router
from backend.api.bill_extraction import router as bill_extraction_router
from backend.api.bills import router as bills_router
from backend.api.health import router as health_router
from backend.api.me import router as me_router
from backend.api.users import router as users_router
from backend.api.vendor_accounts import router as vendor_accounts_router
from backend.api.vendors import router as vendors_router
from backend.log_setup import configure_logging
from backend.settings import get_settings

configure_logging()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # A missing or malformed setting stops the server here, naming the
    # variable, instead of surfacing later as a confusing 401 or 500. On
    # Render the failed deploy leaves the previous version live.
    get_settings()
    yield


app = FastAPI(
    title="Property Bill Automation API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://cohort-team-2026-dsd-mighty-phi.vercel.app",
        "https://cohort-team-2026-dsd-mighty.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Before bills_router, so POST /bills/extract can never be taken for a
# /bills/{bill_id} route.
app.include_router(bill_extraction_router)
app.include_router(bills_router)
app.include_router(approvals_router)
app.include_router(vendors_router)
app.include_router(vendor_accounts_router)
app.include_router(bill_documents_router)
app.include_router(me_router)
app.include_router(users_router)
app.include_router(health_router)


@app.get("/")
def read_root():
    return {"message": "API is running"}

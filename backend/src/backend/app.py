from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.api.approvals import router as approvals_router
from backend.api.bill_documents import router as bill_documents_router
from backend.api.bills import router as bills_router
from backend.api.me import router as me_router
from backend.api.vendor_accounts import router as vendor_accounts_router
from backend.api.vendors import router as vendors_router
from backend.settings import get_settings
from backend.supabase_client import get_supabase


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


app.include_router(bills_router)
app.include_router(approvals_router)
app.include_router(vendors_router)
app.include_router(vendor_accounts_router)
app.include_router(bill_documents_router)
app.include_router(me_router)


@app.get("/")
def read_root():
    return {"message": "API is running"}


@app.get("/test-db")
def test_database():
    try:
        client = get_supabase()

        response = client.table("test_connection").select("*").execute()

        return {"connected": True, "records": response.data}

    except Exception as err:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed",
        ) from err

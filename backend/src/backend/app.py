from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.api.approvals import router as approvals_router
from backend.api.bills import router as bills_router
from backend.api.vendor_accounts import router as vendor_accounts_router
from backend.api.vendors import router as vendors_router
from backend.supabase_client import get_supabase

app = FastAPI(
    title="Property Bill Automation API",
    version="0.1.0",
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


@app.get("/")
def read_root():
    return {"message": "API is running"}


@app.get("/test-db")
def test_database():
    try:
        client = get_supabase()

        response = (
            client.table("test_connection")
            .select("*")
            .execute()
        )

        return {"connected": True, "records": response.data}

    except Exception as err:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed",
        ) from err

from fastapi import FastAPI

from backend.api.approvals import router as approvals_router
from backend.api.bills import router as bills_router
from backend.api.vendor_accounts import router as vendor_accounts_router
from backend.api.vendors import router as vendors_router

app = FastAPI(
    title="Property Bill Automation API",
    version="0.1.0",
)

app.include_router(bills_router)
app.include_router(approvals_router)
app.include_router(vendors_router)
app.include_router(vendor_accounts_router)


@app.get("/")
def read_root():
    return {"message": "API is running"}

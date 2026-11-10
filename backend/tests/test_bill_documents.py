from io import BytesIO
from unittest.mock import patch
from uuid import uuid4

import pytest
from current_users import make_user
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from backend.app import app
from backend.auth import get_current_user
from backend.services.bill_storage import validate_pdf


@pytest.mark.asyncio
async def test_valid_pdf():
    file = UploadFile(
        file=BytesIO(b"%PDF-1.4\nsample content"),
        filename="invoice.pdf",
        headers=Headers(
            {
                "content-type": "application/pdf",
            }
        ),
    )

    contents = await validate_pdf(file)

    assert contents.startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_rejects_non_pdf():
    file = UploadFile(
        file=BytesIO(b"This is not a PDF document"),
        filename="invoice.pdf",
        headers=Headers(
            {
                "content-type": "application/pdf",
            }
        ),
    )

    with pytest.raises(HTTPException) as exc:
        await validate_pdf(file)

    assert exc.value.status_code == 400


def test_upload_document_requires_authentication():
    client = TestClient(app)

    bill_id = uuid4()

    response = client.post(
        f"/bills/{bill_id}/document",
        files={
            "file": (
                "invoice.pdf",
                b"%PDF-1.4\nsample",
                "application/pdf",
            )
        },
    )

    assert response.status_code == 401


def test_upload_document_success():
    bill_id = uuid4()
    user_id = str(uuid4())
    storage_path = f"bills/{bill_id}/invoice.pdf"

    app.dependency_overrides[get_current_user] = lambda: make_user(user_id)

    try:
        with (
            patch("backend.api.bill_documents.get_admin_supabase"),
            patch(
                "backend.api.bill_documents.get_editable_draft",
                return_value={
                    "bill_id": str(bill_id),
                    "status": "draft",
                    "document_path": None,
                },
            ),
            patch(
                "backend.api.bill_documents.generate_storage_path",
                return_value=storage_path,
            ),
            patch("backend.api.bill_documents.upload_pdf") as mock_upload,
            patch(
                "backend.api.bill_documents.attach_document",
                return_value={
                    "bill_id": str(bill_id),
                    "status": "draft",
                    "document_path": storage_path,
                },
            ) as mock_attach,
        ):
            client = TestClient(app)

            response = client.post(
                f"/bills/{bill_id}/document",
                files={
                    "file": (
                        "invoice.pdf",
                        b"%PDF-1.4\nsample",
                        "application/pdf",
                    )
                },
            )

            assert response.status_code == 201
            assert response.json()["document_path"] == storage_path

            mock_upload.assert_called_once()
            mock_attach.assert_called_once()
    finally:
        app.dependency_overrides.clear()

from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile

from supabase import Client

BUCKET_NAME = "invoices"
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MiB


async def validate_pdf(file: UploadFile) -> bytes:
    # The declared content type comes from the client and can be anything: it
    # is only a cheap first filter. The `%PDF-` signature check below is the
    # real guard; do not remove it on the assumption that this check suffices.
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=415,
            detail="Only PDF files are supported.",
        )

    contents = await file.read(MAX_FILE_SIZE + 1)

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="PDF must be 10 MiB or smaller.",
        )

    if not contents.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="Invalid PDF file.",
        )

    return contents


def generate_storage_path(bill_id: UUID) -> str:
    return f"bills/{bill_id}/{uuid4()}.pdf"


def upload_pdf(
    client: Client,
    storage_path: str,
    contents: bytes,
) -> None:
    client.storage.from_(BUCKET_NAME).upload(
        path=storage_path,
        file=contents,
        file_options={
            "content-type": "application/pdf",
            "upsert": "false",
        },
    )


def delete_pdf(
    client: Client,
    storage_path: str,
) -> None:
    client.storage.from_(BUCKET_NAME).remove([storage_path])


def create_pdf_signed_url(
    client: Client,
    storage_path: str,
    expires_in: int = 300,
) -> str:
    response = client.storage.from_(BUCKET_NAME).create_signed_url(
        path=storage_path,
        expires_in=expires_in,
    )

    return response["signedURL"]

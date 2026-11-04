"""Status of an extraction, exactly per the DC-52 spec Status table."""

from collections.abc import Sequence

from backend.extraction.schema import (
    BillExtraction,
    DocumentType,
    ExtractionStatus,
    Issue,
)


def decide_status(
    extraction: BillExtraction | None,
    issues: Sequence[Issue],
    *,
    failed_reason: str | None,
) -> ExtractionStatus:
    """failed > not_an_invoice > needs_attention > ready_for_review.

    `failed` is a pre-check rejection, model error or timeout, or output that did
    not fit the schema: the caller passes `failed_reason`. No extraction without a
    reason is a caller bug and also fails closed rather than looking ready.
    """
    if failed_reason is not None or extraction is None:
        return ExtractionStatus.failed
    if extraction.document_type == DocumentType.not_an_invoice:
        return ExtractionStatus.not_an_invoice
    if issues:
        return ExtractionStatus.needs_attention
    return ExtractionStatus.ready_for_review

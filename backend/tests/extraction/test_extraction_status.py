import pytest
from bill_factory import clean_extraction, not_an_invoice

from backend.extraction.schema import ExtractionStatus, Issue, IssueCode
from backend.extraction.status import decide_status

ISSUE = Issue(code=IssueCode.BAD_DATE, field="due_date", message="bad")


def test_failed_when_a_reason_is_given():
    status = decide_status(None, [], failed_reason="file too large")
    assert status == ExtractionStatus.failed


def test_failed_wins_over_everything_else():
    status = decide_status(clean_extraction(), [ISSUE], failed_reason="model timeout")
    assert status == ExtractionStatus.failed
    status = decide_status(not_an_invoice(), [], failed_reason="schema mismatch")
    assert status == ExtractionStatus.failed


def test_no_extraction_without_a_reason_fails_closed():
    assert decide_status(None, [], failed_reason=None) == ExtractionStatus.failed


def test_not_an_invoice():
    status = decide_status(not_an_invoice(), [], failed_reason=None)
    assert status == ExtractionStatus.not_an_invoice


def test_not_an_invoice_wins_over_issues():
    status = decide_status(not_an_invoice(), [ISSUE], failed_reason=None)
    assert status == ExtractionStatus.not_an_invoice


@pytest.mark.parametrize("count", [1, 3])
def test_any_issue_needs_attention(count: int):
    status = decide_status(clean_extraction(), [ISSUE] * count, failed_reason=None)
    assert status == ExtractionStatus.needs_attention


def test_no_issues_is_ready_for_review():
    status = decide_status(clean_extraction(), [], failed_reason=None)
    assert status == ExtractionStatus.ready_for_review

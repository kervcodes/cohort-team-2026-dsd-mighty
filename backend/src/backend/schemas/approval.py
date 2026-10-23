from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from backend.schemas.common import ApprovalStatus
from backend.schemas.user import UserSummary


class ApprovalDecisionType(Enum):
    APPROVE = "approve"
    REJECT = "reject"


class ApprovalDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: ApprovalDecisionType
    comments: str | None = None


class ApprovalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    bill_id: UUID
    status: ApprovalStatus
    reviewer: UserSummary | None = None
    comments: str | None = None
    requested_at: datetime | None = None
    decided_at: datetime | None = None

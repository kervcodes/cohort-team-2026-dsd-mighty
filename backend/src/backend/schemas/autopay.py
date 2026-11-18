from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.schemas.bill import Money
from backend.schemas.payment import CENT


class AutopaySettingsRead(BaseModel):
    """The one autopay setting (migration 20261117140000_autopay)."""

    enabled: bool
    # Bills up to this amount are paid automatically; kept while autopay is off.
    limit_amount: Decimal | None = None
    # The admin who last changed it, and their current name; None until then.
    updated_by: UUID | None = None
    updated_by_name: str | None = None
    updated_at: datetime

    @field_validator("limit_amount")
    @classmethod
    def in_cents(cls, limit: Decimal | None) -> Decimal | None:
        # PostgREST sends numeric(12,2) as a JSON number, so 400.00 arrives as 400.0.
        return None if limit is None else limit.quantize(CENT)


class AutopaySettingsUpdate(BaseModel):
    """`PUT /autopay-settings`: both fields, every time. Turning autopay on
    without a limit is refused by the route with a 422."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    limit_amount: Money | None = Field(gt=0)

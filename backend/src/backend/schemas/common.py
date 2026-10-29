from enum import StrEnum
from typing import Literal

ActiveStatus = Literal["active", "inactive"]

class PaymentMethod(StrEnum):
    CHECK = "check"
    ACH = "ach"
    WIRE = "wire"
    CREDIT_CARD = "credit_card"
    OTHER = "other"


ApprovalStatus = Literal["pending", "approved", "rejected"]
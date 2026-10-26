from typing import Literal
from enum import StrEnum

ActiveStatus = Literal["active", "inactive"]

PaymentMethod = Literal["check", "ach", "wire", "credit_card", "other"]

BillStatus = Literal[
    "draft",
    "needs_review",
    "matched",
    "pending_approval",
    "approved",
    "payment_in_progress",
    "paid",
    "payment_failed",
    "rejected",
    "duplicate",
    "void",
]

ApprovalStatus = Literal["pending", "approved", "rejected"]

class AccountStatus(StrEnum):
    unpaid = "unpaid"
    outstanding = "outstanding"
    paid = "paid"

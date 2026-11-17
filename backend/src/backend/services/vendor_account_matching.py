"""Which vendor account a bill belongs to: the one place the rule lives.

A bill matches a vendor account when the two account numbers are the same
once normalized: lowercased, with everything but ASCII letters and digits
removed, so "2000-4567 00" matches "2000456700". Only active accounts count.

- The analyst picked an account: that account, if it exists and is active.
- Otherwise exactly one active account with the same number: that account.
- Otherwise (none, or several): no match; the bill stays unmatched.

A matched bill points at the account and at the account's vendor and
property; an unmatched bill has all three null. `vendor_account_picked` says
whether the analyst picked the account (true) or the number found it, or
nothing did (false). A reopened draft sends back only a picked account, so a
match the number found is worked out again on the next save.
"""

import re
from collections.abc import Iterable, Mapping
from typing import Any
from uuid import UUID

from backend.services import vendor_account_repository
from supabase import Client

NOT_LETTER_OR_DIGIT = re.compile(r"[^0-9a-z]")

UNMATCHED: dict[str, str | bool | None] = {
    "vendor_account_id": None,
    "vendor_id": None,
    "property_id": None,
    "vendor_account_picked": False,
}


class UnusableVendorAccount(Exception):
    """The picked vendor account does not exist or is not active."""


def normalize_account_number(account_number: str) -> str:
    return NOT_LETTER_OR_DIGIT.sub("", account_number.lower())


def same_account_number[T: Mapping[str, Any]](
    accounts: Iterable[T], account_number: str | None
) -> list[T]:
    """The accounts whose `account_number` normalizes to the same value.

    A number with no letters or digits matches nothing.
    """
    wanted = normalize_account_number(account_number or "")
    if not wanted:
        return []
    return [
        account
        for account in accounts
        if normalize_account_number(account["account_number"]) == wanted
    ]


def match_columns(
    client: Client,
    account_number: str | None,
    picked_account_id: UUID | None,
) -> dict[str, str | bool | None]:
    """The bill's `vendor_account_id`, `vendor_id`, `property_id` and
    `vendor_account_picked`.

    Raises UnusableVendorAccount when the picked account cannot be used.
    """
    if picked_account_id is not None:
        account = vendor_account_repository.get_account(client, picked_account_id)
        if account is None:
            raise UnusableVendorAccount("Vendor account not found.")
        if account["status"] != "active":
            raise UnusableVendorAccount("This vendor account is inactive.")
        return {
            "vendor_account_id": str(account["id"]),
            "vendor_id": str(account["vendor_id"]),
            "property_id": str(account["property_id"]),
            "vendor_account_picked": True,
        }

    matches = same_account_number(
        vendor_account_repository.list_active_account_options(client), account_number
    )
    if len(matches) != 1:
        return dict(UNMATCHED)

    (match,) = matches
    return {
        "vendor_account_id": match["id"],
        "vendor_id": match["vendor_id"],
        "property_id": match["property_id"],
        "vendor_account_picked": False,
    }

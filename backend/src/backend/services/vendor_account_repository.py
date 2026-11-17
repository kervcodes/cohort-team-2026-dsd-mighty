"""Reads and writes `public.vendor_accounts`.

The table names its key `account_id`; the API calls it `id`. The portal
password never touches a column: it lives in Supabase Vault and only the SQL
functions of migration 20261115100000_vendor_portal_login set, clear or read
it. The row keeps the Vault secret id, which the API turns into
`portal_password_set` and never returns.

Creates and updates each go through one SQL function call, so an account's
columns and its password change in one transaction or not at all.
"""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from postgrest.exceptions import APIError
from pydantic import SecretStr

from backend.schemas.vendor_account import VendorAccountCreate, VendorAccountUpdate
from supabase import Client

COLUMNS = (
    "account_id,property_id,vendor_id,account_number,account_type,"
    "payment_method,portal_url,portal_login_email,portal_password_secret_id,"
    "status,created_at"
)

# A vendor account as the bill form lists it: the vendor's name and the
# property's name come embedded through the account's foreign keys.
OPTION_COLUMNS = (
    "account_id,account_number,vendor_id,property_id,"
    "vendor:vendors!vendor_id(vendor_name),"
    "property:properties!property_id(property_name)"
)

UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"

# What `update_vendor_account` does with the password: omitted from the PATCH
# keeps it, null clears it, a value sets it.
PasswordAction = Literal["keep", "clear", "set"]


class DuplicateVendorAccount(Exception):
    """The property already has this account number with this vendor."""


class UnknownReference(Exception):
    """The property or vendor the account names does not exist."""


@dataclass(frozen=True)
class PortalLogin:
    """What the payment agent signs in to the vendor's portal with."""

    portal_url: str | None
    email: str | None
    # SecretStr: printing or logging a PortalLogin never shows the password.
    password: SecretStr | None


def _to_api(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["account_id"],
        "property_id": row["property_id"],
        "vendor_id": row["vendor_id"],
        "account_number": row["account_number"],
        "account_type": row["account_type"],
        "payment_method": row["payment_method"],
        "portal_url": row.get("portal_url"),
        "portal_login_email": row.get("portal_login_email"),
        "portal_password_set": row.get("portal_password_secret_id") is not None,
        "status": row["status"],
        "created_at": row["created_at"],
    }


def _exists(client: Client, table: str, column: str, value: UUID) -> bool:
    response = (
        client.table(table)
        .select(column)
        .eq(column, str(value))
        .maybe_single()
        .execute()
    )
    # maybe_single() returns None (not an empty result) when no row matches.
    return response is not None and isinstance(response.data, dict)


def get_account(client: Client, account_id: UUID) -> dict[str, Any] | None:
    response = (
        client.table("vendor_accounts")
        .select(COLUMNS)
        .eq("account_id", str(account_id))
        .maybe_single()
        .execute()
    )
    row = response.data if response is not None else None

    return _to_api(row) if isinstance(row, dict) else None


def list_accounts_for_vendor(client: Client, vendor_id: UUID) -> list[dict[str, Any]]:
    response = (
        client.table("vendor_accounts")
        .select(COLUMNS)
        .eq("vendor_id", str(vendor_id))
        .order("account_number")
        .execute()
    )

    return [_to_api(row) for row in response.data or []]


def list_active_account_options(client: Client) -> list[dict[str, Any]]:
    """Every active account with its vendor's and property's names, by vendor
    name, then account number."""
    response = (
        client.table("vendor_accounts")
        .select(OPTION_COLUMNS)
        .eq("status", "active")
        .execute()
    )
    options = [
        {
            "id": row["account_id"],
            "account_number": row["account_number"],
            "vendor_id": row["vendor_id"],
            "vendor_name": row["vendor"]["vendor_name"],
            "property_id": row["property_id"],
            "property_name": row["property"]["property_name"],
        }
        for row in response.data or []
    ]
    # Sorted here, ignoring case, so "acme" and "Acme" sort together.
    return sorted(
        options,
        key=lambda option: (option["vendor_name"].casefold(), option["account_number"]),
    )


def create_account(client: Client, account: VendorAccountCreate) -> dict[str, Any]:
    """Insert the account and store its portal password, if any, in Vault, in
    one transaction.

    Raises UnknownReference or DuplicateVendorAccount.
    """
    if not _exists(client, "properties", "property_id", account.property_id):
        raise UnknownReference("Property not found.")
    if not _exists(client, "vendors", "vendor_id", account.vendor_id):
        raise UnknownReference("Vendor not found.")

    password = account.portal_password
    try:
        response = client.rpc(
            "create_vendor_account",
            {
                "p_account": account.model_dump(
                    mode="json", exclude={"portal_password"}
                ),
                "p_password": (
                    password.get_secret_value() if password is not None else None
                ),
            },
        ).execute()
    except APIError as error:
        if error.code == UNIQUE_VIOLATION:
            raise DuplicateVendorAccount from error
        if error.code == FOREIGN_KEY_VIOLATION:
            # Deleted between the check above and the insert.
            raise UnknownReference("Property or vendor not found.") from error
        raise

    return _to_api(response.data[0])


def update_account(
    client: Client,
    account_id: UUID,
    updates: VendorAccountUpdate,
) -> dict[str, Any] | None:
    """Update the account's columns and its password in one transaction;
    return None if no such account exists.

    `exclude_unset` keeps explicit nulls (clear the field) and leaves fields
    the client did not send untouched. The same holds for `portal_password`:
    omitted keeps it, null deletes it from Vault, a value replaces it.

    Raises DuplicateVendorAccount when the new account number is taken.
    """
    action: PasswordAction
    password: str | None = None
    if "portal_password" not in updates.model_fields_set:
        action = "keep"
    elif updates.portal_password is None:
        action = "clear"
    else:
        action = "set"
        password = updates.portal_password.get_secret_value()

    try:
        response = client.rpc(
            "update_vendor_account",
            {
                "p_account_id": str(account_id),
                "p_changes": updates.model_dump(
                    mode="json", exclude_unset=True, exclude={"portal_password"}
                ),
                "p_password_action": action,
                "p_password": password,
            },
        ).execute()
    except APIError as error:
        if error.code == UNIQUE_VIOLATION:
            raise DuplicateVendorAccount from error
        raise

    rows = response.data or []
    return _to_api(rows[0]) if rows else None


def get_portal_login(client: Client, account_id: UUID) -> PortalLogin | None:
    """The portal login for one account, password included, or None if no
    such account exists.

    Server only, for the payment agent: no route returns this.
    """
    response = client.rpc(
        "get_vendor_account_portal_login",
        {"p_account_id": str(account_id)},
    ).execute()
    rows = response.data or []

    if not rows:
        return None

    row = rows[0]
    password = row.get("portal_password")
    return PortalLogin(
        portal_url=row.get("portal_url"),
        email=row.get("portal_login_email"),
        password=SecretStr(password) if password is not None else None,
    )

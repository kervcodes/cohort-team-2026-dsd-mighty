"""The demo seed matches the 10 DSD demo bills.

Each DSD bill's answer key (`evals/bills/expected/*-bill.json`) must have a
seeded vendor account with the same account number, vendor name and portal,
on a property at the bill's service address. Later tickets match uploaded
bills to vendor accounts by these values, so drift breaks the demo.
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest

from backend.evals.run import BACKEND_DIR, BILLS_DIR

SEED_SQL = BACKEND_DIR / "supabase" / "seed.sql"
DSD_BILLS = sorted((BILLS_DIR / "expected").glob("*-bill.json"))

INSERT = re.compile(
    r"insert into public\.(\w+)\s*\(([^)]*)\)\s*values(.*?)on conflict do nothing;",
    re.DOTALL,
)
# A SQL string ('' is an escaped quote), null, a row's parentheses, or a comment.
TOKEN = re.compile(r"'((?:[^']|'')*)'|(null)|([()])|--[^\n]*")

Row = dict[str, str | None]


def parse_seed(sql: str) -> dict[str, list[Row]]:
    """Rows of every `insert ... values ... on conflict do nothing;` by table."""
    tables: dict[str, list[Row]] = {}
    for table, columns, values in INSERT.findall(sql):
        names = [name.strip() for name in columns.split(",")]
        row: list[str | None] = []
        for token in TOKEN.finditer(values):
            text, null, paren = token.groups()
            if text is not None:
                row.append(text.replace("''", "'"))
            elif null:
                row.append(None)
            elif paren == "(":
                row = []
            elif paren == ")":
                assert len(row) == len(names), f"{table} row {row} vs {names}"
                tables.setdefault(table, []).append(dict(zip(names, row, strict=True)))
    return tables


SEED = parse_seed(SEED_SQL.read_text())


def by_id(table: str, key: str) -> dict[str | None, Row]:
    return {row[key]: row for row in SEED[table]}


@pytest.mark.parametrize("path", DSD_BILLS, ids=lambda p: p.stem)
def test_dsd_bill_has_a_seeded_vendor_account(path: Path):
    bill: dict[str, Any] = json.loads(path.read_text())
    accounts = [
        row
        for row in SEED["vendor_accounts"]
        if row["account_number"] == bill["account_number"]
    ]
    assert len(accounts) == 1, f"no single seeded account {bill['account_number']}"
    account = accounts[0]

    vendor = by_id("vendors", "vendor_id")[account["vendor_id"]]
    prop = by_id("properties", "property_id")[account["property_id"]]

    assert vendor["vendor_name"] == bill["vendor_name"]
    assert account["portal_url"] == bill["payment_website"]
    assert account["status"] == "active"
    address = f"{prop['street']}, {prop['city']}, {prop['state']} {prop['zip_code']}"
    assert address == bill["service_address"]


def test_seed_has_no_accounts_beyond_the_dsd_bills():
    bill_numbers = {json.loads(p.read_text())["account_number"] for p in DSD_BILLS}
    seeded = [row["account_number"] for row in SEED["vendor_accounts"]]
    assert len(DSD_BILLS) == 10
    assert sorted(seeded) == sorted(bill_numbers)


@pytest.mark.parametrize(
    ("table", "key"),
    [
        ("properties", "property_id"),
        ("vendors", "vendor_id"),
        ("vendor_accounts", "account_id"),
    ],
)
def test_seed_ids_are_fixed_and_unique(table: str, key: str):
    ids = [row[key] for row in SEED[table]]
    assert all(ids), f"{table} has a row without a fixed {key}"
    assert len(set(ids)) == len(ids)

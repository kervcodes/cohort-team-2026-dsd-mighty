"""Which property a bill's address names: the one place the rule lives.

An address names a property when the property's street appears in it as a
run of whole words, and, if the address has a 5-digit ZIP code after that
street, the ZIP is the property's. Both sides are compared as words: letters
and digits only, lowercased, with common street words shortened ("Street"
and "St" are the same word), so "125 Industrial Way, Springfield, IL 62701"
names a property at "125 Industrial Way" with ZIP "62701". City and state are
not compared: the ZIP already says where, and extracted text spells them in
too many ways.

The address is used in two ways (vendor_account_matching):

- A bill with no vendor account gets the one active property its address
  names. None, or several: no property.
- A bill with a vendor account takes the account's property, and is flagged
  when its address does not name that property. A bill with no address is
  never flagged.
"""

import re
from collections.abc import Iterable, Mapping
from typing import Any

from backend.services import property_repository
from supabase import Client

WORD = re.compile(r"[0-9a-z]+")
FIVE_DIGITS = re.compile(r"[0-9]{5}")

# Street words written out and shortened, all compared as the short form.
SHORT_WORDS = {
    "street": "st",
    "avenue": "ave",
    "av": "ave",
    "road": "rd",
    "drive": "dr",
    "boulevard": "blvd",
    "lane": "ln",
    "court": "ct",
    "place": "pl",
    "parkway": "pkwy",
    "highway": "hwy",
    "circle": "cir",
    "terrace": "ter",
    "trail": "trl",
    "suite": "ste",
    "apartment": "apt",
    "north": "n",
    "south": "s",
    "east": "e",
    "west": "w",
    "northeast": "ne",
    "northwest": "nw",
    "southeast": "se",
    "southwest": "sw",
}


def address_words(address: str) -> list[str]:
    return [SHORT_WORDS.get(word, word) for word in WORD.findall(address.lower())]


def address_names(address: str, street: str, zip_code: str) -> bool:
    """Whether `address` names the property at `street`, `zip_code`."""
    words = address_words(address)
    street_words = address_words(street)
    size = len(street_words)
    if not size:
        return False

    for start in range(len(words) - size + 1):
        if words[start : start + size] != street_words:
            continue
        zips = [word for word in words[start + size :] if FIVE_DIGITS.fullmatch(word)]
        # The last one: "Suite 10001, Dallas, TX 75201" ends with the ZIP.
        if not zips or zips[-1] == zip_code[:5]:
            return True
    return False


def same_property_address[T: Mapping[str, Any]](
    properties: Iterable[T], address: str | None
) -> list[T]:
    """The properties `address` names. An address with no letters or digits
    names none."""
    if not address_words(address or ""):
        return []
    return [
        prop
        for prop in properties
        if address_names(address or "", prop["street"], prop["zip_code"])
    ]


def property_for_address(client: Client, address: str | None) -> str | None:
    """The id of the one active property `address` names, or None."""
    if not address_words(address or ""):
        return None
    matches = same_property_address(
        property_repository.list_active_property_addresses(client), address
    )
    return str(matches[0]["property_id"]) if len(matches) == 1 else None


def address_disagrees(client: Client, address: str | None, property_id: str) -> bool:
    """Whether a bill's `address` fails to name its account's property. A bill
    with no address does not disagree."""
    if not address_words(address or ""):
        return False
    prop = property_repository.get_property_address(client, property_id)
    if prop is None:
        return False
    return not address_names(address or "", prop["street"], prop["zip_code"])

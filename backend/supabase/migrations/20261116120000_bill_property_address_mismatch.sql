-- Whether a matched bill's property address disagrees with the property of
-- its vendor account (backend property_matching). Worked out on every save
-- that works out the match. An unmatched bill has no account to disagree
-- with, so it is never flagged.
-- Existing bills were saved before the check: not flagged.

alter table public.bills
  add column property_address_mismatch boolean not null default false;

-- Only a bill with a vendor account can disagree with that account's property.
alter table public.bills
  add constraint bills_mismatch_needs_account check (
    not property_address_mismatch or vendor_account_id is not null
  );

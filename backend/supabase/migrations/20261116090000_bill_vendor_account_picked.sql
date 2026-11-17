-- Whether a bill's vendor account was picked by the analyst (true), or found
-- by the account number match or left unmatched (false). A reopened draft
-- sends only a picked account back, so the server works out a found match
-- again on the next save (backend vendor_account_matching).
-- Existing bills were matched by number or not at all: not picked.

alter table public.bills
  add column vendor_account_picked boolean not null default false;

-- A pick is always of an account.
alter table public.bills
  add constraint bills_picked_needs_account check (
    not vendor_account_picked or vendor_account_id is not null
  );

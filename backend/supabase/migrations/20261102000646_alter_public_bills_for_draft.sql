-- Allow bills to be saved as drafts.
-- Draft bills can be incomplete; non-drafts must still have the core fields.

alter table public.bills
  alter column property_address drop not null,
  alter column account_status drop not null,
  alter column website_name drop not null,
  alter column invoice_number drop not null,
  alter column invoice_date drop not null,
  alter column due_date drop not null,
  alter column account_number_raw drop not null,
  alter column amount drop not null;

alter table public.bills
  drop constraint if exists bills_required_unless_draft;

alter table public.bills
  add constraint bills_required_unless_draft check (
    status = 'draft'
    or (
      invoice_number is not null
      and invoice_date is not null
      and due_date is not null
      and amount is not null
      and account_number_raw is not null
    )
  );

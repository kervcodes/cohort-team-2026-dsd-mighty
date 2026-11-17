-- The create, draft-submit and resubmit approval functions write the vendor
-- account match the backend sends (migration
-- 20261116100000_approval_functions_write_vendor_account_match).
-- Runs in one transaction that rolls back.

begin;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-0000000000d1',
    'match-test@example.com',
    '{"full_name": "Match Test"}'
);

insert into public.properties (property_id, property_name, street, city, state, zip_code)
values (
    '00000000-0000-4000-8000-0000000000a1',
    'Test Property', '1 Main St', 'Dallas', 'TX', '75201'
);

insert into public.vendors (vendor_id, vendor_name)
values ('00000000-0000-4000-8000-0000000000b1', 'Test Vendor');

insert into public.vendor_accounts (
    account_id, property_id, vendor_id, account_number, account_type, payment_method
)
values (
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000b1',
    'ACC-1', 'water', 'ach'
);

create function pg_temp.fields(p_invoice text, p_picked boolean) returns jsonb
language sql as $$
    select jsonb_build_object(
        'account_number_raw', 'ACC-1',
        'invoice_number', p_invoice,
        'invoice_date', '2026-11-01',
        'due_date', '2026-11-30',
        'amount', 100.00,
        'vendor_account_id', '00000000-0000-4000-8000-0000000000c1',
        'vendor_id', '00000000-0000-4000-8000-0000000000b1',
        'property_id', '00000000-0000-4000-8000-0000000000a1',
        'vendor_account_picked', p_picked
    )
$$;

create temp table fixture_bills (name text primary key, bill_id uuid not null);

-- 1. create_bill_with_approval

insert into fixture_bills
select 'created', public.create_bill_with_approval(
    pg_temp.fields('INV-CREATE', true),
    '00000000-0000-4000-8000-0000000000d1'
);

select results_eq(
    $$ select vendor_account_id, vendor_id, property_id, vendor_account_picked
       from public.bills where bill_id = (select bill_id from fixture_bills where name = 'created') $$,
    $$ values (
        '00000000-0000-4000-8000-0000000000c1'::uuid,
        '00000000-0000-4000-8000-0000000000b1'::uuid,
        '00000000-0000-4000-8000-0000000000a1'::uuid,
        true
    ) $$,
    'create keeps the matched account, vendor, property and the pick'
);

select throws_ok(
    $$ select public.create_bill_with_approval(
           pg_temp.fields('inv-create ', false),
           '00000000-0000-4000-8000-0000000000d1'
       ) $$,
    '23505',
    null,
    'a second bill with the same invoice number on the account is refused'
);

select is(
    (select count(*)::int from public.bills where vendor_account_id = '00000000-0000-4000-8000-0000000000c1'),
    1,
    'the refused bill left nothing behind'
);

-- 2. submit_draft_bill_with_approval

insert into public.bills (bill_id, submitted_by, status)
values (
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000d1',
    'draft'
);

select lives_ok(
    $$ select public.submit_draft_bill_with_approval(
           '00000000-0000-4000-8000-0000000000e1',
           pg_temp.fields('INV-DRAFT', false),
           '00000000-0000-4000-8000-0000000000d1'
       ) $$,
    'a draft submits with a match'
);

select results_eq(
    $$ select vendor_account_id, vendor_account_picked
       from public.bills where bill_id = '00000000-0000-4000-8000-0000000000e1' $$,
    $$ values ('00000000-0000-4000-8000-0000000000c1'::uuid, false) $$,
    'the submitted draft keeps the account and the not-picked flag'
);

-- 3. resubmit_bill_with_approval

-- A non-draft bill must carry the required invoice fields
-- (bills_required_unless_draft).
insert into public.bills (
    bill_id, submitted_by, status,
    account_number_raw, invoice_number, invoice_date, due_date, amount
)
values (
    '00000000-0000-4000-8000-0000000000e2',
    '00000000-0000-4000-8000-0000000000d1',
    'rejected',
    'ACC-1', 'INV-REJECTED', '2026-11-01', '2026-11-30', 100.00
);

select lives_ok(
    $$ select public.resubmit_bill_with_approval(
           '00000000-0000-4000-8000-0000000000e2',
           pg_temp.fields('INV-RESUBMIT', true),
           '00000000-0000-4000-8000-0000000000d1'
       ) $$,
    'a rejected bill resubmits with a match'
);

select results_eq(
    $$ select vendor_account_id, vendor_id, property_id, vendor_account_picked
       from public.bills where bill_id = '00000000-0000-4000-8000-0000000000e2' $$,
    $$ values (
        '00000000-0000-4000-8000-0000000000c1'::uuid,
        '00000000-0000-4000-8000-0000000000b1'::uuid,
        '00000000-0000-4000-8000-0000000000a1'::uuid,
        true
    ) $$,
    'the resubmitted bill keeps the account, vendor, property and the pick'
);

select is(
    (select status::text from public.bills where bill_id = '00000000-0000-4000-8000-0000000000e2'),
    'pending_approval',
    'the resubmitted bill awaits approval'
);

select * from finish();

rollback;

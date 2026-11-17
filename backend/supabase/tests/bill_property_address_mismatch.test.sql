-- Bills record whether their address disagrees with their vendor account's
-- property (migration 20261116120000_bill_property_address_mismatch).
-- Runs in one transaction that rolls back.

begin;

select plan(7);

-- 1. COLUMN

select has_column(
    'public', 'bills', 'property_address_mismatch',
    'bills has property_address_mismatch'
);

select col_type_is(
    'public', 'bills', 'property_address_mismatch', 'boolean',
    'property_address_mismatch is a boolean'
);

select col_not_null(
    'public', 'bills', 'property_address_mismatch',
    'property_address_mismatch is never null'
);

select col_default_is(
    'public', 'bills', 'property_address_mismatch', 'false',
    'a bill is not flagged unless the write says so'
);

-- 2. FIXTURES

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-0000000000d2',
    'mismatch-test@example.com',
    '{"full_name": "Mismatch Test"}'
);

insert into public.properties (property_id, property_name, street, city, state, zip_code)
values (
    '00000000-0000-4000-8000-0000000000a2',
    'Test Property', '1 Main St', 'Dallas', 'TX', '75201'
);

insert into public.vendors (vendor_id, vendor_name)
values ('00000000-0000-4000-8000-0000000000b2', 'Test Vendor');

insert into public.vendor_accounts (
    account_id, property_id, vendor_id, account_number, account_type, payment_method
)
values (
    '00000000-0000-4000-8000-0000000000c2',
    '00000000-0000-4000-8000-0000000000a2',
    '00000000-0000-4000-8000-0000000000b2',
    'ACC-2', 'water', 'ach'
);

-- 3. ONLY A BILL WITH AN ACCOUNT CAN BE FLAGGED

select lives_ok(
    $$ insert into public.bills (
           submitted_by, vendor_account_id, property_id, property_address_mismatch
       )
       values (
           '00000000-0000-4000-8000-0000000000d2',
           '00000000-0000-4000-8000-0000000000c2',
           '00000000-0000-4000-8000-0000000000a2',
           true
       ) $$,
    'a bill with an account can be flagged'
);

select lives_ok(
    $$ insert into public.bills (submitted_by, property_id)
       values (
           '00000000-0000-4000-8000-0000000000d2',
           '00000000-0000-4000-8000-0000000000a2'
       ) $$,
    'a bill can have a property without an account'
);

select throws_ok(
    $$ insert into public.bills (submitted_by, property_address_mismatch)
       values ('00000000-0000-4000-8000-0000000000d2', true) $$,
    '23514',
    null,
    'a bill with no account cannot be flagged'
);

select * from finish();

rollback;

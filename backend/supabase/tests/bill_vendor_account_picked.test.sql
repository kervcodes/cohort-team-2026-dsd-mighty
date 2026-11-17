-- Bills record whether their vendor account was picked by the analyst
-- (migration 20261116090000_bill_vendor_account_picked).
-- Runs in one transaction that rolls back.

begin;

select plan(6);

-- 1. COLUMN

select has_column(
    'public', 'bills', 'vendor_account_picked',
    'bills has vendor_account_picked'
);

select col_type_is(
    'public', 'bills', 'vendor_account_picked', 'boolean',
    'vendor_account_picked is a boolean'
);

select col_not_null(
    'public', 'bills', 'vendor_account_picked',
    'vendor_account_picked is never null'
);

select col_default_is(
    'public', 'bills', 'vendor_account_picked', 'false',
    'a bill is not picked unless the write says so'
);

-- 2. FIXTURES

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-0000000000d1',
    'picked-test@example.com',
    '{"full_name": "Picked Test"}'
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

-- 3. A PICK IS ALWAYS OF AN ACCOUNT

select lives_ok(
    $$ insert into public.bills (submitted_by, vendor_account_id, vendor_account_picked)
       values (
           '00000000-0000-4000-8000-0000000000d1',
           '00000000-0000-4000-8000-0000000000c1',
           true
       ) $$,
    'a bill can be picked to an account'
);

select throws_ok(
    $$ insert into public.bills (submitted_by, vendor_account_picked)
       values ('00000000-0000-4000-8000-0000000000d1', true) $$,
    '23514',
    null,
    'a bill with no account cannot be picked'
);

select * from finish();

rollback;

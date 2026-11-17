-- Vendor portal passwords live in Vault; an account's columns and its
-- password are created and updated in one transaction; only the service role
-- can call the create, update and read functions (migration
-- 20261115100000_vendor_portal_login). Runs in one transaction that rolls
-- back.

begin;

select plan(52);

-- 1. COLUMNS

select has_column(
    'public', 'vendor_accounts', 'portal_login_email',
    'vendor_accounts has portal_login_email'
);

select has_column(
    'public', 'vendor_accounts', 'portal_password_secret_id',
    'vendor_accounts has portal_password_secret_id'
);

-- 2. FIXTURES

insert into public.properties (property_id, property_name, street, city, state, zip_code)
values (
    '00000000-0000-4000-8000-0000000000a1',
    'Test Property', '1 Main St', 'Dallas', 'TX', '75201'
);

insert into public.vendors (vendor_id, vendor_name)
values ('00000000-0000-4000-8000-0000000000b1', 'Test Vendor');

insert into public.vendor_accounts (
    account_id, property_id, vendor_id, account_number, account_type,
    payment_method, portal_url, portal_login_email
)
values (
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000b1',
    'ACC-1', 'water', 'ach', 'https://portal.example', 'ap@example.com'
);

-- 3. SET, REPLACE, READ, CLEAR (the building blocks, called as the owner)

select is(
    (select portal_password_secret_id from public.vendor_accounts
     where account_id = '00000000-0000-4000-8000-0000000000c1'),
    null,
    'a new account has no password'
);

select results_eq(
    $$ select * from public.get_vendor_account_portal_login(
        '00000000-0000-4000-8000-0000000000c1') $$,
    $$ values ('https://portal.example'::text, 'ap@example.com'::text, null::text) $$,
    'reading a login without a password gives a null password'
);

select lives_ok(
    $$ select public.set_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1', 'first-pass') $$,
    'setting a password works'
);

select isnt(
    (select portal_password_secret_id from public.vendor_accounts
     where account_id = '00000000-0000-4000-8000-0000000000c1'),
    null,
    'the account points at its Vault secret'
);

select is(
    (select s.decrypted_secret
     from vault.decrypted_secrets as s
     join public.vendor_accounts as a on a.portal_password_secret_id = s.id
     where a.account_id = '00000000-0000-4000-8000-0000000000c1'),
    'first-pass',
    'the password is in Vault'
);

select is(
    (select count(*)::int
     from public.vendor_accounts as a
     where a::text like '%first-pass%'),
    0,
    'the account row never holds the password'
);

select is(
    (select count(*)::int
     from vault.secrets
     where secret like '%first-pass%'),
    0,
    'Vault stores the password encrypted'
);

create temporary table first_secret on commit drop as
select portal_password_secret_id as id
from public.vendor_accounts
where account_id = '00000000-0000-4000-8000-0000000000c1';

select lives_ok(
    $$ select public.set_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1', 'second-pass') $$,
    'replacing a password works'
);

select is(
    (select portal_password_secret_id from public.vendor_accounts
     where account_id = '00000000-0000-4000-8000-0000000000c1'),
    (select id from first_secret),
    'replacing keeps the same Vault secret'
);

select results_eq(
    $$ select * from public.get_vendor_account_portal_login(
        '00000000-0000-4000-8000-0000000000c1') $$,
    $$ values ('https://portal.example'::text, 'ap@example.com'::text, 'second-pass'::text) $$,
    'reading the login gives the new password'
);

select lives_ok(
    $$ select public.clear_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1') $$,
    'clearing a password works'
);

select is(
    (select portal_password_secret_id from public.vendor_accounts
     where account_id = '00000000-0000-4000-8000-0000000000c1'),
    null,
    'clearing nulls the secret id'
);

select is(
    (select count(*)::int from vault.secrets where id = (select id from first_secret)),
    0,
    'clearing deletes the Vault secret'
);

select lives_ok(
    $$ select public.clear_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1') $$,
    'clearing twice is harmless'
);

-- 4. BAD INPUT

select throws_ok(
    $$ select public.set_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1', '') $$,
    '22023',
    null,
    'an empty password is refused'
);

select throws_ok(
    $$ select public.set_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000ff', 'pass') $$,
    'P0002',
    null,
    'setting a password on an unknown account fails'
);

select is_empty(
    $$ select * from public.get_vendor_account_portal_login(
        '00000000-0000-4000-8000-0000000000ff') $$,
    'reading an unknown account gives no row'
);

-- 5. CREATE: THE ACCOUNT AND ITS PASSWORD IN ONE TRANSACTION

create temporary table created on commit drop as
select * from public.create_vendor_account(
    '{"property_id": "00000000-0000-4000-8000-0000000000a1",
      "vendor_id": "00000000-0000-4000-8000-0000000000b1",
      "account_number": "ACC-2", "account_type": "power",
      "payment_method": "check", "portal_url": "https://power.example",
      "portal_login_email": "ap2@example.com", "status": "active"}',
    'create-pass'
);

select results_eq(
    $$ select account_number, portal_login_email, portal_password_secret_id is not null
       from created $$,
    $$ values ('ACC-2'::text, 'ap2@example.com'::text, true) $$,
    'creating returns the new row, pointing at its Vault secret'
);

select results_eq(
    $$ select * from public.get_vendor_account_portal_login(
        (select account_id from created)) $$,
    $$ values ('https://power.example'::text, 'ap2@example.com'::text, 'create-pass'::text) $$,
    'creating stores the password in Vault'
);

select throws_ok(
    $$ select public.create_vendor_account(
        '{"property_id": "00000000-0000-4000-8000-0000000000a1",
          "vendor_id": "00000000-0000-4000-8000-0000000000b1",
          "account_number": "ACC-EMPTY", "account_type": "gas",
          "payment_method": "ach", "status": "active"}',
        '') $$,
    '22023',
    null,
    'creating with an empty password fails'
);

select is(
    (select count(*)::int from public.vendor_accounts
     where account_number = 'ACC-EMPTY'),
    0,
    'a failed password step leaves no account behind'
);

select throws_ok(
    $$ select public.create_vendor_account(
        '{"property_id": "00000000-0000-4000-8000-0000000000a1",
          "vendor_id": "00000000-0000-4000-8000-0000000000b1",
          "account_number": "ACC-1", "account_type": "water",
          "payment_method": "ach", "status": "active"}',
        null) $$,
    '23505',
    null,
    'creating a duplicate account number fails'
);

select throws_ok(
    $$ select public.create_vendor_account(
        '{"property_id": "00000000-0000-4000-8000-0000000000ff",
          "vendor_id": "00000000-0000-4000-8000-0000000000b1",
          "account_number": "ACC-3", "account_type": "water",
          "payment_method": "ach", "status": "active"}',
        null) $$,
    '23503',
    null,
    'creating for an unknown property fails'
);

select throws_ok(
    $$ select public.create_vendor_account(
        '{"property_id": "00000000-0000-4000-8000-0000000000a1",
          "vendor_id": "00000000-0000-4000-8000-0000000000b1",
          "account_number": "ACC-4", "account_type": "water",
          "payment_method": "ach", "status": "active",
          "portal_password": "in-the-wrong-place"}',
        null) $$,
    '22023',
    null,
    'creating refuses unknown fields, portal_password included'
);

-- 6. UPDATE: THE COLUMNS AND THE PASSWORD IN ONE TRANSACTION

select results_eq(
    $$ select account_type, portal_url, portal_login_email
       from public.update_vendor_account(
           (select account_id from created),
           '{"account_type": "sewer", "portal_url": null}', 'keep', null) $$,
    $$ values ('sewer'::text, null::text, 'ap2@example.com'::text) $$,
    'an update changes sent columns, nulls null ones and keeps absent ones'
);

select is(
    (select portal_password from public.get_vendor_account_portal_login(
        (select account_id from created))),
    'create-pass',
    'keep leaves the password as it is'
);

select throws_ok(
    $$ select public.update_vendor_account(
        (select account_id from created),
        '{"account_type": "gas", "portal_login_email": "new@example.com"}',
        'set', '') $$,
    '22023',
    null,
    'an empty password fails the update after its column change'
);

select results_eq(
    $$ select account_type, portal_login_email from public.vendor_accounts
       where account_id = (select account_id from created) $$,
    $$ values ('sewer'::text, 'ap2@example.com'::text) $$,
    'a failed password step leaves the columns unchanged'
);

select is(
    (select portal_password from public.get_vendor_account_portal_login(
        (select account_id from created))),
    'create-pass',
    'a failed password step leaves the password unchanged'
);

select throws_ok(
    $$ select public.update_vendor_account(
        (select account_id from created),
        '{"account_number": "ACC-1"}', 'set', 'never-stored') $$,
    '23505',
    null,
    'updating to a taken account number fails'
);

select is(
    (select portal_password from public.get_vendor_account_portal_login(
        (select account_id from created))),
    'create-pass',
    'a failed column change leaves the password unchanged'
);

select lives_ok(
    $$ select public.update_vendor_account(
        (select account_id from created),
        '{"portal_login_email": "new@example.com"}', 'set', 'update-pass') $$,
    'an update changes a column and the password together'
);

select results_eq(
    $$ select * from public.get_vendor_account_portal_login(
        (select account_id from created)) $$,
    $$ values (null::text, 'new@example.com'::text, 'update-pass'::text) $$,
    'the new email and the new password are both stored'
);

select results_eq(
    $$ select portal_password_secret_id is null, portal_login_email
       from public.update_vendor_account(
           (select account_id from created), '{}', 'clear', null) $$,
    $$ values (true, 'new@example.com'::text) $$,
    'clear deletes the password and keeps the columns'
);

select is_empty(
    $$ select * from public.update_vendor_account(
        '00000000-0000-4000-8000-0000000000ff',
        '{"account_type": "gas"}', 'set', 'pass') $$,
    'updating an unknown account gives no row'
);

select throws_ok(
    $$ select public.update_vendor_account(
        (select account_id from created),
        '{"portal_password": "in-the-wrong-place"}', 'keep', null) $$,
    '22023',
    null,
    'an update refuses unknown fields, portal_password included'
);

select throws_ok(
    $$ select public.update_vendor_account(
        (select account_id from created), '{}', 'replace', null) $$,
    '22023',
    null,
    'an unknown password action is refused'
);

select throws_ok(
    $$ select public.update_vendor_account(
        (select account_id from created), '{}', 'keep', 'pass') $$,
    '22023',
    null,
    'a password without the set action is refused'
);

-- 7. DELETING THE ACCOUNT DELETES ITS SECRET

select public.set_vendor_account_portal_password(
    '00000000-0000-4000-8000-0000000000c1', 'third-pass'
);

create temporary table third_secret on commit drop as
select portal_password_secret_id as id
from public.vendor_accounts
where account_id = '00000000-0000-4000-8000-0000000000c1';

delete from public.vendor_accounts
where account_id = '00000000-0000-4000-8000-0000000000c1';

select is(
    (select count(*)::int from vault.secrets where id = (select id from third_secret)),
    0,
    'deleting an account deletes its Vault secret'
);

-- 8. ONLY THE SERVICE ROLE MAY CALL THE FUNCTIONS

set local role authenticated;

select throws_ok(
    $$ select public.get_vendor_account_portal_login(
        '00000000-0000-4000-8000-0000000000c1') $$,
    '42501',
    null,
    'a signed-in user cannot read a portal login'
);

select throws_ok(
    $$ select public.set_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1', 'pass') $$,
    '42501',
    null,
    'a signed-in user cannot set a portal password'
);

select throws_ok(
    $$ select public.create_vendor_account(
        '{"property_id": "00000000-0000-4000-8000-0000000000a1",
          "vendor_id": "00000000-0000-4000-8000-0000000000b1",
          "account_number": "ACC-5", "account_type": "water",
          "payment_method": "ach", "status": "active"}',
        null) $$,
    '42501',
    null,
    'a signed-in user cannot create an account through the function'
);

select throws_ok(
    $$ select public.update_vendor_account(
        '00000000-0000-4000-8000-0000000000c1', '{}', 'clear', null) $$,
    '42501',
    null,
    'a signed-in user cannot update an account through the function'
);

reset role;
set local role anon;

select throws_ok(
    $$ select public.clear_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1') $$,
    '42501',
    null,
    'an anonymous user cannot clear a portal password'
);

select throws_ok(
    $$ select public.update_vendor_account(
        '00000000-0000-4000-8000-0000000000c1', '{}', 'clear', null) $$,
    '42501',
    null,
    'an anonymous user cannot update an account through the function'
);

reset role;
set local role service_role;

select lives_ok(
    $$ select public.get_vendor_account_portal_login(
        '00000000-0000-4000-8000-0000000000c1') $$,
    'the service role can read a portal login'
);

select lives_ok(
    $$ select public.create_vendor_account(
        '{"property_id": "00000000-0000-4000-8000-0000000000a1",
          "vendor_id": "00000000-0000-4000-8000-0000000000b1",
          "account_number": "ACC-6", "account_type": "water",
          "payment_method": "ach", "status": "active"}',
        'service-pass') $$,
    'the service role can create an account with its password'
);

select lives_ok(
    $$ select public.update_vendor_account(
        '00000000-0000-4000-8000-0000000000c1', '{}', 'keep', null) $$,
    'the service role can update an account'
);

-- A separate set or clear call could not share the column change's
-- transaction, so the backend cannot make one.

select throws_ok(
    $$ select public.set_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1', 'pass') $$,
    '42501',
    null,
    'the service role cannot set a password outside an update'
);

select throws_ok(
    $$ select public.clear_vendor_account_portal_password(
        '00000000-0000-4000-8000-0000000000c1') $$,
    '42501',
    null,
    'the service role cannot clear a password outside an update'
);

reset role;

select * from finish();

rollback;

-- audit.capture() and its triggers log every change to the bill workflow
-- tables into audit.record_changes
-- (migration 20261110180000_create_audit_trail, sections 4 and 5).
-- Runs in one transaction that rolls back.

begin;

select plan(35);

-- 1. WIRING

select has_trigger('public', 'bills', 'audit_bills', 'bills is audited');
select has_trigger('public', 'approvals', 'audit_approvals', 'approvals is audited');
select has_trigger('public', 'payments', 'audit_payments', 'payments is audited');
select has_trigger('public', 'vendors', 'audit_vendors', 'vendors is audited');
select has_trigger(
    'public', 'vendor_accounts', 'audit_vendor_accounts', 'vendor_accounts is audited'
);
select has_trigger('public', 'properties', 'audit_properties', 'properties is audited');
select has_trigger('public', 'app_users', 'audit_app_users', 'app_users is audited');

-- 2. FIXTURES

-- The log may already hold rows (a development database).
select set_config('t.base', (select count(*) from audit.record_changes)::text, true);

-- Users: admin ...a1, analyst ...b1 (the author), analyst ...b2, approver ...c1
-- and an inactive admin ...d1. Signup creates inactive analysts.
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000a1', 'admin@example.com'),
    ('00000000-0000-4000-8000-0000000000b1', 'author@example.com'),
    ('00000000-0000-4000-8000-0000000000b2', 'other.analyst@example.com'),
    ('00000000-0000-4000-8000-0000000000c1', 'approver@example.com'),
    ('00000000-0000-4000-8000-0000000000d1', 'inactive.admin@example.com');

select is(
    (select count(*)::int from audit.record_changes),
    current_setting('t.base')::int,
    'a signup writes no audit row'
);

update public.app_users set role = 'admin', status = 'active'
where user_id = '00000000-0000-4000-8000-0000000000a1';
update public.app_users set status = 'active'
where user_id in (
    '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000b2'
);
update public.app_users set role = 'approver', status = 'active'
where user_id = '00000000-0000-4000-8000-0000000000c1';
update public.app_users set role = 'admin'
where user_id = '00000000-0000-4000-8000-0000000000d1';

-- 3. APP_USERS: ONLY PRIVILEGE CHANGES

select results_eq(
    $$
        select op, changed_cols, old_row ->> 'role', new_row ->> 'role', actor_id
        from audit.record_changes
        where table_name = 'app_users'
            and record_pk ->> 'user_id' = '00000000-0000-4000-8000-0000000000c1'
    $$,
    $$
        values (
            'UPDATE'::text,
            array['role', 'status']::text[],
            'analyst'::text,
            'approver'::text,
            null::uuid
        )
    $$,
    'a role change is logged with both roles and the changed columns'
);

select is(
    (select bill_id from audit.record_changes
     where table_name = 'app_users'
        and record_pk ->> 'user_id' = '00000000-0000-4000-8000-0000000000c1'),
    null,
    'an app_users row belongs to no bill'
);

update public.app_users set full_name = 'Renamed'
where user_id = '00000000-0000-4000-8000-0000000000c1';

select is(
    (select count(*)::int from audit.record_changes
     where table_name = 'app_users'
        and record_pk ->> 'user_id' = '00000000-0000-4000-8000-0000000000c1'),
    1,
    'a name change is not a privilege change and is not logged'
);

-- 4. BILLS: INSERT, UPDATE, NO-OP UPDATE, DELETE

insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status, created_at, updated_at
)
values (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000b1',
    'INV-1', '2026-11-01', '2026-12-01', 100.00,
    '1234567890', 'pending_approval', '2026-01-01', '2026-01-01'
);

select results_eq(
    $$
        select op, record_pk, bill_id, old_row is null,
            new_row ->> 'invoice_number', new_row ->> 'amount', changed_cols is null
        from audit.record_changes
        where table_name = 'bills'
            and bill_id in (
                '10000000-0000-4000-8000-000000000001',
                '10000000-0000-4000-8000-000000000002'
            )
    $$,
    $$
        values (
            'INSERT'::text,
            '{"bill_id": "10000000-0000-4000-8000-000000000001"}'::jsonb,
            '10000000-0000-4000-8000-000000000001'::uuid,
            true,
            'INV-1'::text,
            '100.00'::text,
            true
        )
    $$,
    'inserting a bill logs exactly one INSERT with the new row'
);

update public.bills set amount = 250.00
where bill_id = '10000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, changed_cols, old_row ->> 'amount', new_row ->> 'amount',
            old_row ->> 'status', new_row ->> 'status'
        from audit.record_changes
        where table_name = 'bills'
            and bill_id = '10000000-0000-4000-8000-000000000001'
            and op = 'UPDATE'
    $$,
    $$
        values (
            'UPDATE'::text,
            array['amount']::text[],
            '100.00'::text,
            '250.00'::text,
            'pending_approval'::text,
            'pending_approval'::text
        )
    $$,
    'an edit logs the before and after values and only the changed column'
);

-- updated_at was 2026-01-01 and the update above moved it to now(); this
-- update changes nothing else, and set_updated_at() rewrites updated_at to
-- the same now() as before.
update public.bills set amount = amount
where bill_id = '10000000-0000-4000-8000-000000000001';

select is(
    (select count(*)::int from audit.record_changes
     where table_name = 'bills' and bill_id = '10000000-0000-4000-8000-000000000001'),
    2,
    'an update that changes nothing writes no row'
);

-- A fresh bill whose updated_at is in the past: the no-op update below moves
-- updated_at, which alone must not count as a change.
insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status, created_at, updated_at
)
values (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-0000000000b1',
    'INV-2', '2026-11-01', '2026-12-01', 40.00,
    '555', 'draft', '2026-01-01', '2026-01-01'
);

update public.bills set amount = 40.00
where bill_id = '10000000-0000-4000-8000-000000000002';

select is(
    (select count(*)::int from audit.record_changes
     where table_name = 'bills' and bill_id = '10000000-0000-4000-8000-000000000002'),
    1,
    'a save that only moves updated_at writes no row'
);

update public.bills set status = 'pending_approval'
where bill_id = '10000000-0000-4000-8000-000000000001';
update public.bills set status = 'approved'
where bill_id = '10000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select old_row ->> 'status', new_row ->> 'status'
        from audit.record_changes
        where table_name = 'bills'
            and bill_id = '10000000-0000-4000-8000-000000000001'
            and changed_cols = array['status']
    $$,
    $$ values ('pending_approval'::text, 'approved'::text) $$,
    'a status change is logged with both statuses'
);

-- 5. THE OTHER AUDITED TABLES

insert into public.properties (property_id, property_name, street, city, state, zip_code)
values (
    '20000000-0000-4000-8000-000000000001', 'Oak Court', '1 Oak St', 'Dallas', 'TX', '75201'
);
update public.properties set property_name = 'Oak Court II'
where property_id = '20000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, bill_id, changed_cols
        from audit.record_changes
        where table_name = 'properties'
            and record_pk ->> 'property_id' = '20000000-0000-4000-8000-000000000001'
        order by id
    $$,
    $$
        values
            ('INSERT'::text, null::uuid, null::text[]),
            ('UPDATE'::text, null::uuid, array['property_name']::text[])
    $$,
    'properties are logged, with no bill'
);

insert into public.vendors (vendor_id, vendor_name, contact_email)
values ('30000000-0000-4000-8000-000000000001', 'City Water', 'bills@citywater.example');
update public.vendors set contact_email = 'ap@citywater.example'
where vendor_id = '30000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, old_row ->> 'contact_email', new_row ->> 'contact_email'
        from audit.record_changes
        where table_name = 'vendors'
            and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
        order by id
    $$,
    $$
        values
            ('INSERT'::text, null::text, 'bills@citywater.example'::text),
            ('UPDATE'::text, 'bills@citywater.example'::text, 'ap@citywater.example'::text)
    $$,
    'a vendor contact change is logged with the old and new email'
);

insert into public.vendor_accounts (
    account_id, property_id, vendor_id, account_number, account_type, payment_method
)
values (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '11112222', 'water', 'ach'
);
update public.vendor_accounts set payment_method = 'wire'
where account_id = '40000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, old_row ->> 'payment_method', new_row ->> 'payment_method'
        from audit.record_changes
        where table_name = 'vendor_accounts'
            and record_pk ->> 'account_id' = '40000000-0000-4000-8000-000000000001'
        order by id
    $$,
    $$
        values
            ('INSERT'::text, null::text, 'ach'::text),
            ('UPDATE'::text, 'ach'::text, 'wire'::text)
    $$,
    'a change of payment method on a vendor account is logged'
);

insert into public.approvals (approval_id, bill_id)
values (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
);
update public.approvals
set approval_status = 'approved',
    reviewer_id = '00000000-0000-4000-8000-0000000000c1',
    decision_at = now()
where approval_id = '50000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, bill_id, changed_cols, new_row ->> 'reviewer_id'
        from audit.record_changes
        where table_name = 'approvals'
            and record_pk ->> 'approval_id' = '50000000-0000-4000-8000-000000000001'
        order by id
    $$,
    $$
        values
            ('INSERT'::text, '10000000-0000-4000-8000-000000000001'::uuid,
                null::text[], null::text),
            ('UPDATE'::text, '10000000-0000-4000-8000-000000000001'::uuid,
                array['approval_status', 'decision_at', 'reviewer_id']::text[],
                '00000000-0000-4000-8000-0000000000c1'::text)
    $$,
    'an approval is logged with the reviewer and belongs to its bill'
);

insert into public.payments (
    payment_id, bill_id, payment_method, amount, attempt_number
)
values (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'ach', 250.00, 1
);
update public.payments set payment_status = 'failed', failure_reason = 'insufficient funds'
where payment_id = '60000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, bill_id, changed_cols
        from audit.record_changes
        where table_name = 'payments'
            and record_pk ->> 'payment_id' = '60000000-0000-4000-8000-000000000001'
        order by id
    $$,
    $$
        values
            ('INSERT'::text, '10000000-0000-4000-8000-000000000001'::uuid, null::text[]),
            ('UPDATE'::text, '10000000-0000-4000-8000-000000000001'::uuid,
                array['failure_reason', 'payment_status']::text[])
    $$,
    'a payment is logged and belongs to its bill'
);

delete from public.payments
where payment_id = '60000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select op, old_row ->> 'payment_status', new_row is null, changed_cols is null
        from audit.record_changes
        where table_name = 'payments'
            and record_pk ->> 'payment_id' = '60000000-0000-4000-8000-000000000001'
            and op = 'DELETE'
    $$,
    $$ values ('DELETE'::text, 'failed'::text, true, true) $$,
    'a delete logs the deleted row and no new row'
);

delete from public.approvals
where approval_id = '50000000-0000-4000-8000-000000000001';
delete from public.bills
where bill_id = '10000000-0000-4000-8000-000000000002';

select results_eq(
    $$
        select op, old_row ->> 'invoice_number', new_row is null
        from audit.record_changes
        where table_name = 'bills'
            and bill_id in (
                '10000000-0000-4000-8000-000000000001',
                '10000000-0000-4000-8000-000000000002'
            )
            and op = 'DELETE'
    $$,
    $$ values ('DELETE'::text, 'INV-2'::text, true) $$,
    'deleting a bill logs the bill as it was'
);

-- 6. MASKED IN THE LOG

select is(
    (select new_row ->> 'account_number' from audit.record_changes
     where table_name = 'vendor_accounts' and op = 'INSERT'
        and record_pk ->> 'account_id' = '40000000-0000-4000-8000-000000000001'),
    '****2222',
    'a vendor account number is stored masked, last four kept'
);

select is(
    (select new_row ->> 'account_number_raw' from audit.record_changes
     where table_name = 'bills' and op = 'INSERT'
        and bill_id = '10000000-0000-4000-8000-000000000001'),
    '****7890',
    'the account number on a bill is stored masked'
);

select is(
    (select new_row ->> 'account_number_raw' from audit.record_changes
     where table_name = 'bills' and op = 'INSERT'
        and bill_id = '10000000-0000-4000-8000-000000000002'),
    '****',
    'a short account number is masked completely'
);

select is(
    (select count(*)::int from audit.record_changes
     where old_row::text like '%1234567890%'
        or new_row::text like '%1234567890%'
        or old_row::text like '%11112222%'
        or new_row::text like '%11112222%'),
    0,
    'no unmasked account number is stored anywhere in the log'
);

update public.vendor_accounts set account_number = '33332222'
where account_id = '40000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select changed_cols, old_row ->> 'account_number', new_row ->> 'account_number'
        from audit.record_changes
        where table_name = 'vendor_accounts'
            and record_pk ->> 'account_id' = '40000000-0000-4000-8000-000000000001'
            and changed_cols = array['account_number']
    $$,
    $$ values (array['account_number']::text[], '****2222'::text, '****2222'::text) $$,
    'a masked column that changed is still named in changed_cols'
);

-- 7. WHO IS NAMED, END TO END

-- The service-role client of the API: the actor comes from the request header.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select set_config(
    'request.headers',
    '{"x-audit-actor-id": "00000000-0000-4000-8000-0000000000b1", "accept": "*/*"}',
    true
);
update public.vendors set vendor_name = 'City Water Dept'
where vendor_id = '30000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select actor_id, actor_role from audit.record_changes
        where table_name = 'vendors'
            and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
            and changed_cols = array['vendor_name']
    $$,
    $$ values ('00000000-0000-4000-8000-0000000000b1'::uuid, 'service_role'::text) $$,
    'a service-role write records the user named in the request header'
);

select set_config('request.headers', '{"x-audit-actor-id": "not-a-uuid"}', true);

select lives_ok(
    $$ update public.vendors set vendor_name = 'City Water 3'
       where vendor_id = '30000000-0000-4000-8000-000000000001' $$,
    'a malformed actor header does not fail the write'
);

select is(
    (select actor_id from audit.record_changes
     where table_name = 'vendors'
         and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
        and new_row ->> 'vendor_name' = 'City Water 3'),
    null,
    'a malformed actor header records no actor'
);

-- A browser role must not name someone else.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config(
    'request.headers',
    '{"x-audit-actor-id": "00000000-0000-4000-8000-0000000000a1"}',
    true
);
update public.vendors set vendor_name = 'City Water 4'
where vendor_id = '30000000-0000-4000-8000-000000000001';

select results_eq(
    $$
        select actor_id, actor_role from audit.record_changes
        where table_name = 'vendors'
            and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
        and new_row ->> 'vendor_name' = 'City Water 4'
    $$,
    $$ values (null::uuid, 'anon'::text) $$,
    'the actor header is ignored unless the caller is the service role'
);

-- Scripts and direct SQL: an app.actor_id setting in the transaction.
select set_config('request.jwt.claims', '', true);
select set_config('request.headers', '', true);
select set_config('app.actor_id', '00000000-0000-4000-8000-0000000000b2', true);
update public.vendors set vendor_name = 'City Water 6'
where vendor_id = '30000000-0000-4000-8000-000000000001';

select is(
    (select actor_id from audit.record_changes
     where table_name = 'vendors'
         and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
        and new_row ->> 'vendor_name' = 'City Water 6'),
    '00000000-0000-4000-8000-0000000000b2'::uuid,
    'the app.actor_id setting names the actor for direct SQL'
);

select ok(
    (select actor_role from audit.record_changes
     where table_name = 'vendors'
         and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
        and new_row ->> 'vendor_name' = 'City Water 6')
        = session_user::text collate "default",
    'a connection with no JWT records its login role'
);

select set_config('app.actor_id', '', true);
update public.vendors set vendor_name = 'City Water 7'
where vendor_id = '30000000-0000-4000-8000-000000000001';

select is(
    (select actor_id from audit.record_changes
     where table_name = 'vendors'
         and record_pk ->> 'vendor_id' = '30000000-0000-4000-8000-000000000001'
        and new_row ->> 'vendor_name' = 'City Water 7'),
    null,
    'with no actor named, the actor is null'
);

select * from finish();

rollback;

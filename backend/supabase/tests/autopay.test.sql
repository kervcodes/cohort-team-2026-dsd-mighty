-- The autopay setting and the trigger of a payment run
-- (migration 20261117140000_autopay).
-- Runs in one transaction that rolls back.

begin;

select plan(28);

-- 1. FIXTURES

-- The signup trigger creates the app_users row.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000301', 'admin@example.com');

update public.app_users set role = 'admin', status = 'active'
where user_id = '00000000-0000-4000-8000-000000000301';

insert into public.bills (
    bill_id, property_address, account_status, website_name, submitted_by,
    invoice_number, invoice_date, due_date, amount, account_number_raw, status
)
values (
    '00000000-0000-4000-8000-0000000003b1', '1 Main St', 'unpaid',
    'example.com', '00000000-0000-4000-8000-000000000301',
    'BILL-301', '2026-11-01', '2026-11-30', 120.50, '2000456700', 'approved'
);

-- 2. THE ONE ROW

select has_table('public', 'autopay_settings', 'autopay_settings exists');

select is(
    (select relrowsecurity from pg_catalog.pg_class
     where oid = 'public.autopay_settings'::regclass),
    true,
    'autopay_settings has row-level security on'
);

select results_eq(
    $$ select id, enabled, limit_amount, updated_by from public.autopay_settings $$,
    $$ values (true, false, null::numeric, null::uuid) $$,
    'the migration seeds one row: autopay off, no limit, never changed'
);

select throws_ok(
    $$ insert into public.autopay_settings (id) values (true) $$,
    '23505',
    null,
    'a second row with the same key is refused'
);

select throws_ok(
    $$ insert into public.autopay_settings (id) values (false) $$,
    '23514',
    null,
    'a row with any other key is refused'
);

select fk_ok(
    'public', 'autopay_settings', 'updated_by',
    'public', 'app_users', 'user_id',
    'autopay_settings.updated_by references app_users'
);

-- 3. THE LIMIT

select throws_ok(
    $$ update public.autopay_settings set enabled = true $$,
    '23514',
    null,
    'autopay cannot be on without a limit'
);

select throws_ok(
    $$ update public.autopay_settings set limit_amount = 0 $$,
    '23514',
    null,
    'a limit of 0 is refused'
);

select throws_ok(
    $$ update public.autopay_settings set limit_amount = -5 $$,
    '23514',
    null,
    'a negative limit is refused'
);

select col_type_is(
    'public', 'autopay_settings', 'limit_amount', 'numeric(12,2)',
    'the limit is money: numeric(12,2)'
);

-- Back-date the row, so the update below visibly moves updated_at.
update public.autopay_settings set updated_at = now() - interval '1 day';

select lives_ok(
    $$
        update public.autopay_settings
        set enabled = true,
            limit_amount = 500,
            updated_by = '00000000-0000-4000-8000-000000000301'
    $$,
    'autopay can be turned on with a limit'
);

select results_eq(
    $$
        select enabled, limit_amount, updated_by, updated_at = now()
        from public.autopay_settings
    $$,
    $$ values (true, 500.00::numeric, '00000000-0000-4000-8000-000000000301'::uuid, true) $$,
    'the change is saved with who made it, and updated_at moves'
);

select results_eq(
    $$
        select op, changed_cols, new_row ->> 'limit_amount'
        from audit.record_changes
        where table_name = 'autopay_settings'
        order by id desc
        limit 1
    $$,
    $$ values ('UPDATE'::text, array['enabled', 'limit_amount', 'updated_by'], '500.00'::text) $$,
    'a change to the setting is written to the audit log'
);

select lives_ok(
    $$ update public.autopay_settings set enabled = false $$,
    'autopay can be turned off and keep its limit'
);

select is(
    (select limit_amount from public.autopay_settings),
    500.00::numeric,
    'the limit is kept while autopay is off'
);

select is(
    (select confdeltype from pg_catalog.pg_constraint
     where conrelid = 'public.autopay_settings'::regclass and contype = 'f'),
    'n'::"char",
    'deleting the admin who last changed it keeps the setting (set null)'
);

-- 4. PAYMENT RUN TRIGGER

select col_default_is(
    'public', 'payment_runs', 'trigger', 'manual'::text,
    'a run is manual unless said otherwise'
);

insert into public.payment_runs (run_id, bill_id, started_by)
values (
    '00000000-0000-4000-8000-0000000003c1',
    '00000000-0000-4000-8000-0000000003b1',
    '00000000-0000-4000-8000-000000000301'
);

select is(
    (select trigger from public.payment_runs
     where run_id = '00000000-0000-4000-8000-0000000003c1'),
    'manual',
    'a new run is manual by default'
);

select lives_ok(
    $$
        update public.payment_runs set trigger = 'autopay'
        where run_id = '00000000-0000-4000-8000-0000000003c1'
    $$,
    'a run can be marked as started by autopay'
);

select throws_ok(
    $$
        update public.payment_runs set trigger = 'scheduled'
        where run_id = '00000000-0000-4000-8000-0000000003c1'
    $$,
    '23514',
    null,
    'any other trigger is refused'
);

select throws_ok(
    $$
        update public.payment_runs set trigger = null
        where run_id = '00000000-0000-4000-8000-0000000003c1'
    $$,
    '23502',
    null,
    'every run has a trigger'
);

-- 5. ACCESS

select table_privs_are(
    'public', 'autopay_settings', 'service_role', array['SELECT', 'UPDATE'],
    'the service role can only read and change the row'
);

select table_privs_are(
    'public', 'autopay_settings', 'authenticated', array[]::text[],
    'signed-in users have no privilege on the setting'
);

select table_privs_are(
    'public', 'autopay_settings', 'anon', array[]::text[],
    'anonymous users have no privilege on the setting'
);

set local role service_role;

select throws_ok(
    $$ delete from public.autopay_settings $$,
    '42501',
    null,
    'the service role cannot delete the row'
);

select throws_ok(
    $$ insert into public.autopay_settings (id) values (true) $$,
    '42501',
    null,
    'the service role cannot add a row'
);

reset role;
set local role authenticated;

select throws_ok(
    $$ select 1 from public.autopay_settings $$,
    '42501',
    null,
    'signed-in users cannot read the setting directly'
);

reset role;

select is(
    (select count(*)::int from public.autopay_settings),
    1,
    'there is still exactly one row'
);

select * from finish();

rollback;

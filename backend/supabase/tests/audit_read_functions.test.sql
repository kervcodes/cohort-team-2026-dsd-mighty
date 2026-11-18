-- Reading the audit log through the API's functions, audit_changes and
-- audit_bill_changes (migration 20261118100000_audit_read_functions).
-- Runs in one transaction that rolls back.
--
-- The database may already hold log rows (the seed's, a developer's), so
-- every check filters on rows this test writes: its own bills and actors.

begin;

select plan(48);

-- 1. WIRING

select has_function(
    'public', 'audit_changes',
    array['text', 'uuid', 'uuid', 'date', 'date', 'bigint', 'integer'],
    'audit_changes exists'
);

select has_function(
    'public', 'audit_bill_changes', array['uuid'],
    'audit_bill_changes exists'
);

select is_definer(
    'public', 'audit_changes',
    array['text', 'uuid', 'uuid', 'date', 'date', 'bigint', 'integer'],
    'audit_changes is security definer'
);

select is_definer(
    'public', 'audit_bill_changes', array['uuid'],
    'audit_bill_changes is security definer'
);

select volatility_is(
    'public', 'audit_changes',
    array['text', 'uuid', 'uuid', 'date', 'date', 'bigint', 'integer'],
    'stable',
    'audit_changes is stable'
);

select volatility_is(
    'public', 'audit_bill_changes', array['uuid'], 'stable',
    'audit_bill_changes is stable'
);

-- 2. WHO MAY CALL THEM

select ok(
    not has_function_privilege(
        'anon',
        'public.audit_changes(text, uuid, uuid, date, date, bigint, integer)',
        'execute'
    ),
    'anon cannot execute audit_changes'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'public.audit_changes(text, uuid, uuid, date, date, bigint, integer)',
        'execute'
    ),
    'authenticated cannot execute audit_changes'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.audit_changes(text, uuid, uuid, date, date, bigint, integer)',
        'execute'
    ),
    'service_role can execute audit_changes'
);

select ok(
    not has_function_privilege('anon', 'public.audit_bill_changes(uuid)', 'execute'),
    'anon cannot execute audit_bill_changes'
);

select ok(
    not has_function_privilege(
        'authenticated', 'public.audit_bill_changes(uuid)', 'execute'
    ),
    'authenticated cannot execute audit_bill_changes'
);

select ok(
    has_function_privilege(
        'service_role', 'public.audit_bill_changes(uuid)', 'execute'
    ),
    'service_role can execute audit_bill_changes'
);

-- A null proacl means the default grant to PUBLIC.
select is_empty(
    $$
        select 1
        from pg_catalog.pg_proc as p,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
        where p.oid in (
            'public.audit_changes(text, uuid, uuid, date, date, bigint, integer)'::regprocedure,
            'public.audit_bill_changes(uuid)'::regprocedure
        )
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
    $$,
    'PUBLIC cannot execute either function'
);

-- 3. FIXTURES

-- Users: ...e1 (Ada Admin) and ...e2 (Try Approver). ...e3 has no app_users
-- row: a user who is gone.
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000e1', 'ada@example.com'),
    ('00000000-0000-4000-8000-0000000000e2', 'try@example.com');

update public.app_users set full_name = 'Ada Admin', role = 'admin', status = 'active'
where user_id = '00000000-0000-4000-8000-0000000000e1';
update public.app_users set full_name = 'Try Approver', role = 'approver', status = 'active'
where user_id = '00000000-0000-4000-8000-0000000000e2';

-- Bill ...f1: created by ...e1, submitted by ...e2. Bill ...f2: another bill.
-- The triggers write their log rows; the account number is masked there.
select set_config('app.actor_id', '00000000-0000-4000-8000-0000000000e1', true);

insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status
)
values (
    '20000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-0000000000e1',
    'INV-F1', '2026-11-01', '2026-12-01', 186.42, '2000456700', 'draft'
);

select set_config('app.actor_id', '00000000-0000-4000-8000-0000000000e2', true);

update public.bills set status = 'pending_approval'
where bill_id = '20000000-0000-4000-8000-0000000000f1';

insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status
)
values (
    '20000000-0000-4000-8000-0000000000f2',
    '00000000-0000-4000-8000-0000000000e2',
    'INV-F2', '2026-11-01', '2026-12-01', 10.00, '888888', 'draft'
);

select set_config('app.actor_id', '', true);

-- Rows by ...e3 at chosen times, written as the owner (the triggers stamp
-- clock_timestamp(), which a test cannot choose): the 9th just before
-- midnight, the 10th at midnight, the 12th late, the 13th at midnight (UTC).
insert into audit.record_changes (
    table_schema, table_name, op, record_pk, new_row, actor_id, actor_role,
    occurred_at
)
values
    ('public', 'vendors', 'INSERT', '{"vendor_id": "v9"}', '{"vendor_id": "v9"}',
     '00000000-0000-4000-8000-0000000000e3', 'service_role',
     '2026-11-09 23:59:59+00'),
    ('public', 'vendors', 'INSERT', '{"vendor_id": "v10"}', '{"vendor_id": "v10"}',
     '00000000-0000-4000-8000-0000000000e3', 'service_role',
     '2026-11-10 00:00:00+00'),
    ('public', 'properties', 'INSERT', '{"property_id": "p12"}',
     '{"property_id": "p12"}',
     '00000000-0000-4000-8000-0000000000e3', 'service_role',
     '2026-11-12 23:59:00+00'),
    ('public', 'vendors', 'INSERT', '{"vendor_id": "v13"}', '{"vendor_id": "v13"}',
     '00000000-0000-4000-8000-0000000000e3', 'service_role',
     '2026-11-13 00:00:00+00');

-- 4. FILTERS, ORDER AND THE ACTOR'S NAME

select results_eq(
    $$
        select table_name, op, changed_cols, actor_name, actor_role
        from public.audit_changes(p_bill_id => '20000000-0000-4000-8000-0000000000f1')
    $$,
    $$
        values
            ('bills'::text, 'UPDATE'::text, array['status']::text[],
             'Try Approver'::text, 'postgres'::text),
            ('bills', 'INSERT', null, 'Ada Admin', 'postgres')
    $$,
    'the bill filter returns that bill''s rows, newest first, with names'
);

select results_eq(
    $$
        select record_pk ->> 'vendor_id', actor_name
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3'
        )
    $$,
    $$
        values ('v13'::text, null::text), (null, null), ('v10', null), ('v9', null)
    $$,
    'the actor filter returns that actor''s rows; a gone user has no name'
);

select results_eq(
    $$
        select record_pk
        from public.audit_changes(
            p_table => 'properties',
            p_actor_id => '00000000-0000-4000-8000-0000000000e3'
        )
    $$,
    $$ values ('{"property_id": "p12"}'::jsonb) $$,
    'the table filter returns that table''s rows'
);

select results_eq(
    $$
        select occurred_at
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_from => '2026-11-10'
        )
    $$,
    $$
        values
            ('2026-11-13 00:00:00+00'::timestamptz),
            ('2026-11-12 23:59:00+00'),
            ('2026-11-10 00:00:00+00')
    $$,
    'from includes the whole UTC day, from midnight'
);

select results_eq(
    $$
        select occurred_at
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_to => '2026-11-12'
        )
    $$,
    $$
        values
            ('2026-11-12 23:59:00+00'::timestamptz),
            ('2026-11-10 00:00:00+00'),
            ('2026-11-09 23:59:59+00')
    $$,
    'to includes the whole UTC day, up to midnight'
);

select results_eq(
    $$
        select occurred_at
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_from => '2026-11-12',
            p_to => '2026-11-12'
        )
    $$,
    $$ values ('2026-11-12 23:59:00+00'::timestamptz) $$,
    'from and to on the same day give that day'
);

select is_empty(
    $$
        select 1
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_from => '2026-11-13',
            p_to => '2026-11-12'
        )
    $$,
    'from after to gives nothing'
);

select is(
    (
        select count(*)::int
        from public.audit_changes(
            p_table => 'vendors',
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_from => '2026-11-10',
            p_to => '2026-11-12'
        )
    ),
    1,
    'filters combine'
);

-- The actor's name is read when asked, not when the row was written.
update public.app_users set full_name = 'Ada Renamed'
where user_id = '00000000-0000-4000-8000-0000000000e1';

select is(
    (
        select actor_name
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1')
        where op = 'INSERT'
    ),
    'Ada Renamed',
    'the actor''s name is the current one'
);

-- 5. KEYSET PAGING

select results_eq(
    $$
        select record_pk ->> 'vendor_id', has_more
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_limit => 2
        )
    $$,
    $$ values ('v13'::text, true), (null, true) $$,
    'a first page of two says more follow'
);

select set_config(
    't.page_end',
    (
        select min(id)::text
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_limit => 2
        )
    ),
    true
);

select results_eq(
    $$
        select record_pk ->> 'vendor_id', has_more
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_before_id => current_setting('t.page_end')::bigint,
            p_limit => 2
        )
    $$,
    $$ values ('v10'::text, false), ('v9', false) $$,
    'the next page starts below the last id, and an exactly full last page says no more'
);

select is_empty(
    $$
        select 1
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_before_id => (
                select min(id)
                from audit.record_changes
                where actor_id = '00000000-0000-4000-8000-0000000000e3'
            )
        )
    $$,
    'nothing is older than the oldest row'
);

select results_eq(
    $$
        select record_pk ->> 'vendor_id', has_more
        from public.audit_changes(
            p_actor_id => '00000000-0000-4000-8000-0000000000e3',
            p_limit => 1,
            p_before_id => (
                select min(id) + 1
                from audit.record_changes
                where actor_id = '00000000-0000-4000-8000-0000000000e3'
            )
        )
    $$,
    $$ values ('v9'::text, false) $$,
    'before_id is exclusive'
);

select ok(
    (select count(*) from public.audit_changes()) <= 50,
    'the default page is at most 50 rows'
);

-- 6. INPUT CHECKS

select throws_ok(
    $$ select * from public.audit_changes(p_limit => 0) $$,
    '22023', 'limit must be between 1 and 100',
    'a limit of 0 is refused'
);

select throws_ok(
    $$ select * from public.audit_changes(p_limit => 101) $$,
    '22023', 'limit must be between 1 and 100',
    'a limit of 101 is refused'
);

select throws_ok(
    $$ select * from public.audit_changes(p_limit => null) $$,
    '22023', 'limit must be between 1 and 100',
    'a null limit is refused'
);

select lives_ok(
    $$ select * from public.audit_changes(p_limit => 100) $$,
    'a limit of 100 is allowed'
);

select throws_ok(
    $$ select * from public.audit_changes(p_table => 'payment_runs') $$,
    '22023', 'unknown audited table: payment_runs',
    'a table the triggers do not watch is refused'
);

select throws_ok(
    $$ select * from public.audit_bill_changes(null) $$,
    '22023', 'bill id is required',
    'audit_bill_changes needs a bill'
);

-- 7. ONE BILL'S CHANGES

select results_eq(
    $$
        select op, new_row ->> 'status'
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1')
    $$,
    $$ values ('INSERT'::text, 'draft'::text), ('UPDATE', 'pending_approval') $$,
    'audit_bill_changes returns the bill''s rows oldest first'
);

select is_empty(
    $$
        select 1
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1')
        where bill_id is distinct from '20000000-0000-4000-8000-0000000000f1'
    $$,
    'audit_bill_changes returns no other bill''s rows'
);

select is_empty(
    $$ select 1 from public.audit_bill_changes('20000000-0000-4000-8000-0000000000ff') $$,
    'a bill with no rows has no changes'
);

-- 8. ROWS AS STORED, MASKED

select is(
    (
        select new_row ->> 'account_number_raw'
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1')
        where op = 'INSERT'
    ),
    '****6700',
    'audit_bill_changes returns the account number masked'
);

select is(
    (
        select old_row ->> 'account_number_raw'
        from public.audit_changes(p_bill_id => '20000000-0000-4000-8000-0000000000f1')
        where op = 'UPDATE'
    ),
    '****6700',
    'audit_changes returns the account number masked'
);

select is_empty(
    $$
        select 1
        from public.audit_changes(p_bill_id => '20000000-0000-4000-8000-0000000000f1')
        where old_row::text like '%2000456700%' or new_row::text like '%2000456700%'
    $$,
    'the plain account number never comes back'
);

select results_eq(
    $$
        select id, table_name, op, record_pk, bill_id, old_row, new_row,
            changed_cols, actor_id, actor_role, occurred_at
        from public.audit_changes(p_bill_id => '20000000-0000-4000-8000-0000000000f1')
    $$,
    $$
        select id, table_name, op, record_pk, bill_id, old_row, new_row,
            changed_cols, actor_id, actor_role, occurred_at
        from audit.record_changes
        where bill_id = '20000000-0000-4000-8000-0000000000f1'
        order by id desc
    $$,
    'audit_changes returns the stored rows unchanged'
);

select results_eq(
    $$
        select id, table_name, op, record_pk, bill_id, old_row, new_row,
            changed_cols, actor_id, actor_role, occurred_at
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1')
    $$,
    $$
        select id, table_name, op, record_pk, bill_id, old_row, new_row,
            changed_cols, actor_id, actor_role, occurred_at
        from audit.record_changes
        where bill_id = '20000000-0000-4000-8000-0000000000f1'
        order by id
    $$,
    'audit_bill_changes returns the stored rows unchanged'
);

-- 9. BROWSER ROLES ARE REFUSED

set local role anon;

select throws_ok(
    $$ select * from public.audit_changes() $$,
    '42501', null,
    'anon is refused audit_changes'
);

select throws_ok(
    $$ select * from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1') $$,
    '42501', null,
    'anon is refused audit_bill_changes'
);

reset role;
set local role authenticated;

select throws_ok(
    $$ select * from public.audit_changes() $$,
    '42501', null,
    'authenticated is refused audit_changes'
);

select throws_ok(
    $$ select * from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1') $$,
    '42501', null,
    'authenticated is refused audit_bill_changes'
);

reset role;
set local role service_role;

select is(
    (
        select count(*)::int
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f1')
    ),
    2,
    'the service role reads a bill''s changes'
);

reset role;

-- 9. ROWS WRITTEN BEFORE A COLUMN WAS MASKED

-- A vendor account change logged before portal_password_secret_id joined
-- audit.mask (20261118100500) holds the full Vault id. Both functions mask
-- it on read.
insert into audit.record_changes (
    table_schema, table_name, op, record_pk, bill_id, old_row, new_row,
    changed_cols, actor_role
)
values (
    'public', 'vendor_accounts', 'UPDATE', '{"account_id": "a1"}',
    '20000000-0000-4000-8000-0000000000f9',
    '{"portal_password_secret_id": null}',
    '{"portal_password_secret_id": "7d2c4e1a-9b3f-4c8d-a1e2-5f6a7b8c1c90"}',
    array['portal_password_secret_id'], 'service_role'
);

select is(
    (
        select new_row ->> 'portal_password_secret_id'
        from public.audit_changes(p_bill_id => '20000000-0000-4000-8000-0000000000f9')
    ),
    '****1c90',
    'audit_changes masks a secret id stored before it was masked'
);

select is(
    (
        select new_row ->> 'portal_password_secret_id'
        from public.audit_bill_changes('20000000-0000-4000-8000-0000000000f9')
    ),
    '****1c90',
    'audit_bill_changes masks a secret id stored before it was masked'
);

select * from finish();

rollback;

-- Payment runs and the worker's claim function
-- (migration 20261117110000_payment_runs).
-- Runs in one transaction that rolls back.

begin;

select plan(30);

-- 1. FIXTURES

-- The signup trigger creates the app_users row.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000201', 'approver@example.com');

insert into public.bills (
    bill_id, property_address, account_status, website_name, submitted_by,
    invoice_number, invoice_date, due_date, amount, account_number_raw, status
)
values
    (
        '00000000-0000-4000-8000-0000000000b1', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000201',
        'BILL-1', '2026-11-01', '2026-11-30', 120.50, '2000456700', 'approved'
    ),
    (
        '00000000-0000-4000-8000-0000000000b2', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000201',
        'BILL-2', '2026-11-01', '2026-11-30', 75.00, '2000456700', 'approved'
    ),
    (
        '00000000-0000-4000-8000-0000000000b3', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000201',
        'BILL-3', '2026-11-01', '2026-11-30', 50.00, '2000456700', 'approved'
    );

-- 2. TABLE RULES

select has_table('public', 'payment_runs', 'payment_runs exists');

select is(
    (select relrowsecurity from pg_catalog.pg_class
     where oid = 'public.payment_runs'::regclass),
    true,
    'payment_runs has row-level security on'
);

select fk_ok(
    'public', 'payment_runs', 'started_by',
    'public', 'app_users', 'user_id',
    'payment_runs.started_by references app_users'
);

select fk_ok(
    'public', 'payment_runs', 'payment_id',
    'public', 'payments', 'payment_id',
    'payment_runs.payment_id references payments'
);

insert into public.payment_runs (run_id, bill_id, started_by, created_at)
values (
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-000000000201',
    now() - interval '2 minutes'
);

select results_eq(
    $$
        select status, steps, started_at, finished_at
        from public.payment_runs
        where run_id = '00000000-0000-4000-8000-0000000000c1'
    $$,
    $$ values ('queued'::text, '[]'::jsonb, null::timestamptz, null::timestamptz) $$,
    'a new run is queued with no steps'
);

select throws_ok(
    $$
        insert into public.payment_runs (bill_id, started_by)
        values (
            '00000000-0000-4000-8000-0000000000b1',
            '00000000-0000-4000-8000-000000000201'
        )
    $$,
    '23505',
    null,
    'a bill has at most one queued or running run'
);

select throws_ok(
    $$
        insert into public.payment_runs (bill_id, started_by, status)
        values (
            '00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-000000000201',
            'paused'
        )
    $$,
    '23514',
    null,
    'status is one of queued, running, paid, flagged, failed'
);

select throws_ok(
    $$
        insert into public.payment_runs (
            bill_id, started_by, status, started_at, finished_at
        )
        values (
            '00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-000000000201',
            'flagged', now(), now()
        )
    $$,
    '23514',
    null,
    'a flagged run needs a flag reason'
);

select throws_ok(
    $$
        insert into public.payment_runs (
            bill_id, started_by, status, started_at, finished_at
        )
        values (
            '00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-000000000201',
            'paid', now(), now()
        )
    $$,
    '23514',
    null,
    'a paid run names its payment'
);

select throws_ok(
    $$
        insert into public.payment_runs (bill_id, started_by, status)
        values (
            '00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-000000000201',
            'running'
        )
    $$,
    '23514',
    null,
    'a running run has a start time'
);

select throws_ok(
    $$
        insert into public.payment_runs (bill_id, started_by, steps)
        values (
            '00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-000000000201',
            '{"step": "x"}'
        )
    $$,
    '23514',
    null,
    'steps is a JSON array'
);

-- A finished run frees the bill for a new one.
insert into public.payment_runs (
    run_id, bill_id, started_by, status, flag_reason, started_at,
    finished_at, created_at
)
values (
    '00000000-0000-4000-8000-0000000000c2',
    '00000000-0000-4000-8000-0000000000b2',
    '00000000-0000-4000-8000-000000000201',
    'flagged', 'Amount differs', now(), now(), now() - interval '10 minutes'
);

select lives_ok(
    $$
        insert into public.payment_runs (run_id, bill_id, started_by, created_at)
        values (
            '00000000-0000-4000-8000-0000000000c3',
            '00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-000000000201',
            now() - interval '1 minute'
        )
    $$,
    'a bill whose earlier run finished can get a new run'
);

-- 3. CLAIMING

-- A run a crashed worker left running half an hour ago.
insert into public.payment_runs (
    run_id, bill_id, started_by, status, started_at, created_at
)
values (
    '00000000-0000-4000-8000-0000000000c4',
    '00000000-0000-4000-8000-0000000000b3',
    '00000000-0000-4000-8000-000000000201',
    'running', now() - interval '30 minutes', now() - interval '31 minutes'
);

create temporary table first_claim on commit drop as
select * from public.claim_next_payment_run();

select results_eq(
    $$ select run_id, status, started_at from first_claim $$,
    $$
        values (
            '00000000-0000-4000-8000-0000000000c1'::uuid,
            'running'::text,
            now()
        )
    $$,
    'claim takes the oldest queued run and marks it running'
);

select is(
    (select steps -> -1 ->> 'step' from first_claim),
    'claimed',
    'claiming appends a step'
);

select is(
    (select status from public.payment_runs
     where run_id = '00000000-0000-4000-8000-0000000000c1'),
    'running',
    'the claimed run is running in the table too'
);

select results_eq(
    $$
        select status, flag_reason is not null, finished_at is not null,
            steps -> -1 ->> 'step'
        from public.payment_runs
        where run_id = '00000000-0000-4000-8000-0000000000c4'
    $$,
    $$ values ('flagged'::text, true, true, 'flagged'::text) $$,
    'a run left running for over 15 minutes is flagged, never re-run'
);

select results_eq(
    $$ select run_id from public.claim_next_payment_run() $$,
    $$ values ('00000000-0000-4000-8000-0000000000c3'::uuid) $$,
    'the next claim takes the next oldest queued run'
);

select is_empty(
    $$ select * from public.claim_next_payment_run() $$,
    'claim returns no row when nothing is queued'
);

select is(
    (select count(*)::int from public.payment_runs where status = 'running'),
    2,
    'each claimed run is claimed once'
);

select throws_ok(
    $$
        insert into public.payment_runs (bill_id, started_by)
        values (
            '00000000-0000-4000-8000-0000000000b1',
            '00000000-0000-4000-8000-000000000201'
        )
    $$,
    '23505',
    null,
    'a running run still blocks a second run for the bill'
);

-- A recently started run is not stale.
select is(
    (select status from public.payment_runs
     where run_id = '00000000-0000-4000-8000-0000000000c3'),
    'running',
    'a run started just now is left running'
);

-- 4. FUNCTION SECURITY

select is(
    (select prosecdef from pg_catalog.pg_proc
     where oid = 'public.claim_next_payment_run()'::regprocedure),
    true,
    'claim_next_payment_run is security definer'
);

select is(
    (select proconfig from pg_catalog.pg_proc
     where oid = 'public.claim_next_payment_run()'::regprocedure),
    array['search_path=""'],
    'claim_next_payment_run pins an empty search_path'
);

select ok(
    not has_function_privilege(
        'anon', 'public.claim_next_payment_run()', 'execute'
    ),
    'anon cannot execute claim_next_payment_run'
);

select ok(
    not has_function_privilege(
        'authenticated', 'public.claim_next_payment_run()', 'execute'
    ),
    'authenticated cannot execute claim_next_payment_run'
);

select ok(
    has_function_privilege(
        'service_role', 'public.claim_next_payment_run()', 'execute'
    ),
    'service_role can execute claim_next_payment_run'
);

-- A null proacl means the default grant to PUBLIC.
select is_empty(
    $$
        select 1
        from pg_catalog.pg_proc as p,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
        where p.oid = 'public.claim_next_payment_run()'::regprocedure
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
    $$,
    'PUBLIC cannot execute claim_next_payment_run'
);

-- Browser roles see no rows: RLS is on and there are no policies.
set local role authenticated;

select is_empty(
    $$ select 1 from public.payment_runs $$,
    'authenticated users read no payment runs directly'
);

select throws_ok(
    $$
        insert into public.payment_runs (bill_id, started_by)
        values (
            '00000000-0000-4000-8000-0000000000b3',
            '00000000-0000-4000-8000-000000000201'
        )
    $$,
    '42501',
    null,
    'authenticated users cannot queue a run directly'
);

reset role;

select is(
    (select count(*)::int from public.payment_runs),
    4,
    'the service owner still sees every run'
);

select * from finish();

rollback;

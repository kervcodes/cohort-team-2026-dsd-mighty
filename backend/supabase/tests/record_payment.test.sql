-- Recording a payment against a bill
-- (migration 20261115120000_record_payment).
-- Runs in one transaction that rolls back.

begin;

select plan(40);

-- 1. FIXTURES

-- The signup trigger creates the app_users row.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000101', 'payer@example.com');

insert into public.bills (
    bill_id, property_address, account_status, website_name, submitted_by,
    invoice_number, invoice_date, due_date, amount, account_number_raw, status
)
values
    (
        '00000000-0000-4000-8000-0000000000a1', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000101',
        'INV-1', '2026-11-01', '2026-11-30', 120.50, 'ACCT-1', 'approved'
    ),
    (
        '00000000-0000-4000-8000-0000000000a2', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000101',
        'INV-2', '2026-11-01', '2026-11-30', 75.00, 'ACCT-1',
        'pending_approval'
    ),
    (
        '00000000-0000-4000-8000-0000000000a3', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000101',
        'INV-3', '2026-11-01', '2026-11-30', 50.00, 'ACCT-1', 'approved'
    );

-- 2. REFUSALS

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000ff', 120.50, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT404',
    null,
    'a missing bill is PT404'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a2', 75.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT409',
    null,
    'a bill that is not approved is PT409'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a2', 75.00, 'ach',
            '2026-11-14', null, 'failed', 'Card declined',
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT409',
    null,
    'a failed attempt on a bill that is not approved is PT409'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 100.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT422',
    null,
    'a completed payment for another amount is PT422'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.50, 'ach',
            '2026-11-14', null, 'pending', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    '22023',
    null,
    'only completed or failed payments are recorded'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.50, 'ach',
            '2026-11-14', null, 'failed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    '23514',
    null,
    'a failed payment needs a failure reason'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.50, 'ach',
            '2026-11-14', null, 'completed', 'Card declined',
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    '23514',
    null,
    'a completed payment has no failure reason'
);

select is_empty(
    $$ select 1 from public.payments $$,
    'refused calls record no payment'
);

-- 3. A FAILED ATTEMPT

select results_eq(
    $$
        select attempt_number, payment_status, failure_reason, amount
        from public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.50, 'credit_card',
            '2026-11-13', null, 'failed', 'Card declined',
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    $$ values (1, 'failed'::text, 'Card declined'::text, 120.50::numeric) $$,
    'a failed attempt is recorded as attempt 1'
);

select is(
    (select status from public.bills
     where bill_id = '00000000-0000-4000-8000-0000000000a1'),
    'approved',
    'a failed attempt leaves the bill approved'
);

select results_eq(
    $$
        select attempt_number
        from public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 99.00, 'check',
            '2026-11-13', null, 'failed', 'Bounced',
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    $$ values (2) $$,
    'a failed attempt need not match the bill amount, and is attempt 2'
);

-- 4. A COMPLETED PAYMENT

select results_eq(
    $$
        select attempt_number, payment_status, amount, payment_method,
            paid_on, provider_reference, failure_reason, recorded_by
        from public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.5, 'ach',
            '2026-11-14', 'ACH-123', 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    $$
        values (
            3, 'completed'::text, 120.50::numeric, 'ach'::text,
            '2026-11-14'::date, 'ACH-123'::text, null::text,
            '00000000-0000-4000-8000-000000000101'::uuid
        )
    $$,
    'a completed payment for the bill amount is recorded as the next attempt'
);

select is(
    (select status from public.bills
     where bill_id = '00000000-0000-4000-8000-0000000000a1'),
    'paid',
    'a completed payment marks the bill paid'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.50, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT409',
    null,
    'a paid bill cannot be paid again'
);

select is(
    (select count(*)::int from public.payments
     where bill_id = '00000000-0000-4000-8000-0000000000a1'),
    3,
    'the bill has its two failed attempts and one completed payment'
);

-- 5. TABLE RULES

select col_type_is(
    'public', 'payments', 'paid_on', 'date',
    'payments.paid_on is a date'
);

select hasnt_column(
    'public', 'payments', 'payment_date',
    'payments.payment_date was renamed to paid_on'
);

-- Even a writer that skips the function cannot pay a bill twice.
select throws_ok(
    $$
        insert into public.payments (
            bill_id, payment_method, amount, attempt_number, payment_status,
            recorded_by
        )
        values (
            '00000000-0000-4000-8000-0000000000a1', 'ach', 120.50, 4,
            'completed', '00000000-0000-4000-8000-000000000101'
        )
    $$,
    '23505',
    null,
    'a bill has at most one completed payment'
);

select throws_ok(
    $$
        insert into public.payments (
            bill_id, payment_method, amount, attempt_number, payment_status,
            failure_reason, recorded_by
        )
        values (
            '00000000-0000-4000-8000-0000000000a2', 'ach', 75.00, 1,
            'pending', 'Not yet', '00000000-0000-4000-8000-000000000101'
        )
    $$,
    '23514',
    null,
    'only a failed payment has a failure reason'
);

select col_not_null(
    'public', 'payments', 'recorded_by',
    'every payment names who recorded it'
);

select fk_ok(
    'public', 'payments', 'recorded_by',
    'public', 'app_users', 'user_id',
    'payments.recorded_by references app_users'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a3', 50.00, 'ach',
            '2026-11-14', null, 'failed', 'Card declined',
            '00000000-0000-4000-8000-0000000000ff'
        )
    $$,
    '23503',
    null,
    'the recorder must be an app user'
);

-- 6. FUNCTION SECURITY

select is(
    (select prosecdef from pg_catalog.pg_proc
     where oid = 'public.record_payment(uuid, numeric, text, date, text, text, text, uuid)'::regprocedure),
    true,
    'record_payment is security definer'
);

select is(
    (select proconfig from pg_catalog.pg_proc
     where oid = 'public.record_payment(uuid, numeric, text, date, text, text, text, uuid)'::regprocedure),
    array['search_path=""'],
    'record_payment pins an empty search_path'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.record_payment(uuid, numeric, text, date, text, text, text, uuid)',
        'execute'
    ),
    'anon cannot execute record_payment'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'public.record_payment(uuid, numeric, text, date, text, text, text, uuid)',
        'execute'
    ),
    'authenticated cannot execute record_payment'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.record_payment(uuid, numeric, text, date, text, text, text, uuid)',
        'execute'
    ),
    'service_role can execute record_payment'
);

-- A null proacl means the default grant to PUBLIC.
select is_empty(
    $$
        select 1
        from pg_catalog.pg_proc as p,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
        where p.oid = 'public.record_payment(uuid, numeric, text, date, text, text, text, uuid)'::regprocedure
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
    $$,
    'PUBLIC cannot execute record_payment'
);

-- 7. THE REFUSAL DETAILS THE BACKEND READS

create function pg_temp.refusal_detail(call text)
returns text
language plpgsql
as $$
declare
    v_detail text;
begin
    execute call;
    return null;
exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail;
end;
$$;

select is(
    pg_temp.refusal_detail($$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a2', 75.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$),
    'pending_approval',
    'PT409 carries the bill status in DETAIL'
);

select is(
    pg_temp.refusal_detail($$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a1', 120.50, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$),
    'paid',
    'PT409 says when the bill is already paid'
);

update public.bills
set status = 'approved'
where bill_id = '00000000-0000-4000-8000-0000000000a2';

select is(
    pg_temp.refusal_detail($$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a2', 70.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$),
    '75.00',
    'PT422 carries the bill amount in DETAIL'
);

select is_empty(
    $$
        select 1 from public.payments
        where bill_id = '00000000-0000-4000-8000-0000000000a2'
    $$,
    'a refused payment leaves no row behind'
);

-- 8. NULLS NEVER READ AS A MATCH

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a3', null, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT422',
    null,
    'a completed payment with no amount is PT422'
);

-- Today bills.status is not null and an approved bill must
-- have an amount (bills_required_unless_draft). The function
-- must not lean on either, so this rolled-back transaction
-- drops both to build bills that break them.
alter table public.bills alter column status drop not null;
alter table public.bills drop constraint bills_required_unless_draft;

insert into public.bills (
    bill_id, property_address, account_status, website_name, submitted_by,
    invoice_number, invoice_date, due_date, amount, account_number_raw, status
)
values
    (
        '00000000-0000-4000-8000-0000000000a4', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000101',
        'INV-4', '2026-11-01', '2026-11-30', 60.00, 'ACCT-1', null
    ),
    (
        '00000000-0000-4000-8000-0000000000a5', '1 Main St', 'unpaid',
        'example.com', '00000000-0000-4000-8000-000000000101',
        'INV-5', '2026-11-01', '2026-11-30', null, 'ACCT-1', 'approved'
    );

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a4', 60.00, 'ach',
            '2026-11-14', null, 'failed', 'Card declined',
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT409',
    null,
    'a failed attempt on a bill with no status is PT409'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a4', 60.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT409',
    null,
    'a bill with no status is PT409'
);

select throws_ok(
    $$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a5', 60.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$,
    'PT422',
    null,
    'a completed payment on a bill with no amount is PT422'
);

select is(
    pg_temp.refusal_detail($$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a4', 60.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$),
    '',
    'PT409 for a bill with no status has an empty DETAIL'
);

select is(
    pg_temp.refusal_detail($$
        select public.record_payment(
            '00000000-0000-4000-8000-0000000000a5', 60.00, 'ach',
            '2026-11-14', null, 'completed', null,
            '00000000-0000-4000-8000-000000000101'
        )
    $$),
    '',
    'PT422 for a bill with no amount has an empty DETAIL'
);

select results_eq(
    $$
        select bill_id, status from public.bills
        where bill_id in (
            '00000000-0000-4000-8000-0000000000a4',
            '00000000-0000-4000-8000-0000000000a5'
        )
        order by bill_id
    $$,
    $$
        values
            ('00000000-0000-4000-8000-0000000000a4'::uuid, null::text),
            ('00000000-0000-4000-8000-0000000000a5'::uuid, 'approved'::text)
    $$,
    'a bill with no status or no amount is never marked paid'
);

select is_empty(
    $$
        select 1 from public.payments
        where bill_id in (
            '00000000-0000-4000-8000-0000000000a3',
            '00000000-0000-4000-8000-0000000000a4',
            '00000000-0000-4000-8000-0000000000a5'
        )
    $$,
    'a null status or amount records no payment'
);

select * from finish();

rollback;

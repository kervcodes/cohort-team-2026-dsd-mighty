-- The bill approval functions enforce their own rules
-- (migrations 20261112225044_create_bill_with_approval,
-- 20261113011727_decide_bill_approval,
-- 20261113205023_resubmit_bill_with_approval,
-- 20261115170000_submit_draft_bill_with_approval).
-- Runs in one transaction that rolls back.

begin;

select plan(31);

-- USERS (the signup trigger creates inactive analysts; set the real roles)

insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000a1', 'owner@example.com'),
    ('00000000-0000-4000-8000-0000000000a2', 'other.analyst@example.com'),
    ('00000000-0000-4000-8000-0000000000b1', 'approver@example.com'),
    ('00000000-0000-4000-8000-0000000000b2', 'inactive.approver@example.com'),
    ('00000000-0000-4000-8000-0000000000c1', 'admin@example.com');

update public.app_users set status = 'active'
where user_id in (
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000a2',
    '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000c1'
);

update public.app_users set role = 'approver'
where user_id in (
    '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000b2'
);

update public.app_users set role = 'admin'
where user_id = '00000000-0000-4000-8000-0000000000c1';

create temp table fixture_bills (name text primary key, bill_id uuid not null);

create function pg_temp.bill_fields(p_amount numeric) returns jsonb
language sql as $$
    select jsonb_build_object(
        'account_number_raw', 'ACCT-1',
        'invoice_number', 'INV-1',
        'invoice_date', '2026-11-01',
        'due_date', '2026-11-30',
        'amount', p_amount,
        'property_address', '1 Main St',
        'account_status', 'active',
        'website_name', 'example.com'
    )
$$;

create function pg_temp.bill_id(p_name text) returns uuid
language sql as $$
    select bill_id from fixture_bills where name = p_name
$$;

create function pg_temp.pending_approval(p_name text) returns uuid
language sql as $$
    select approval_id from public.approvals
    where bill_id = pg_temp.bill_id(p_name) and approval_status = 'pending'
$$;

-- 1. create_bill_with_approval

insert into fixture_bills
select name, public.create_bill_with_approval(
    pg_temp.bill_fields(amount),
    '00000000-0000-4000-8000-0000000000a1'
)
from (values
    ('b4999', 4999.00),
    ('b5000', 5000.00),
    ('b5001', 5001.00),
    ('reject_me', 100.00),
    ('reviewer_checks', 100.00)
) as v(name, amount);

select results_eq(
    $$ select status, submitted_by from public.bills where bill_id = pg_temp.bill_id('b4999') $$,
    $$ values ('pending_approval'::text, '00000000-0000-4000-8000-0000000000a1'::uuid) $$,
    'create_bill_with_approval creates a pending_approval bill for the submitter'
);

select results_eq(
    $$ select approval_status, reviewer_id from public.approvals where bill_id = pg_temp.bill_id('b4999') $$,
    $$ values ('pending'::text, null::uuid) $$,
    'create_bill_with_approval creates one pending approval with no reviewer'
);

-- 2. decide_bill_approval: the $5,000 approver limit

select lives_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('b4999'), '00000000-0000-4000-8000-0000000000b1', 'approve') $$,
    'an approver can approve a $4,999 bill'
);

select results_eq(
    $$ select a.approval_status, a.reviewer_id, a.decision_at is not null, b.status
       from public.approvals a join public.bills b using (bill_id)
       where a.bill_id = pg_temp.bill_id('b4999') $$,
    $$ values ('approved'::text, '00000000-0000-4000-8000-0000000000b1'::uuid, true, 'approved'::text) $$,
    'approving records the reviewer and decision time and approves the bill'
);

select lives_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('b5000'), '00000000-0000-4000-8000-0000000000b1', 'approve') $$,
    'an approver can approve a $5,000 bill'
);

select throws_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('b5001'), '00000000-0000-4000-8000-0000000000b1', 'approve') $$,
    '42501',
    null,
    'an approver cannot approve a $5,001 bill'
);

select throws_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('b5001'), '00000000-0000-4000-8000-0000000000b1', 'reject', 'Too high') $$,
    '42501',
    null,
    'an approver cannot reject a $5,001 bill'
);

select is(
    (select status from public.bills where bill_id = pg_temp.bill_id('b5001')),
    'pending_approval',
    'a refused decision leaves the bill pending'
);

select lives_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('b5001'), '00000000-0000-4000-8000-0000000000c1', 'approve') $$,
    'an admin can approve a $5,001 bill'
);

-- 3. decide_bill_approval: one decision per approval

select throws_ok(
    $$ select public.decide_bill_approval(
           (select approval_id from public.approvals where bill_id = pg_temp.bill_id('b4999')),
           '00000000-0000-4000-8000-0000000000c1', 'reject', 'Changed my mind') $$,
    'P0001',
    null,
    'a decided approval cannot be decided again'
);

select is(
    (select approval_status from public.approvals where bill_id = pg_temp.bill_id('b4999')),
    'approved',
    'the first decision stands'
);

select throws_ok(
    $$ select public.decide_bill_approval(gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'approve') $$,
    'P0002',
    null,
    'a missing approval is P0002'
);

-- 4. decide_bill_approval: rejection needs a comment

select throws_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('reject_me'), '00000000-0000-4000-8000-0000000000b1', 'reject', '   ') $$,
    '22023',
    null,
    'a blank rejection comment is refused'
);

select throws_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('reject_me'), '00000000-0000-4000-8000-0000000000b1', 'reject') $$,
    '22023',
    null,
    'a rejection without a comment is refused'
);

select lives_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('reject_me'), '00000000-0000-4000-8000-0000000000b1', 'reject', '  Wrong amount  ') $$,
    'a rejection with a comment is recorded'
);

select results_eq(
    $$ select a.approval_status, a.comments, b.status
       from public.approvals a join public.bills b using (bill_id)
       where a.bill_id = pg_temp.bill_id('reject_me') $$,
    $$ values ('rejected'::text, 'Wrong amount'::text, 'rejected'::text) $$,
    'rejecting stores the trimmed comment and rejects the bill'
);

-- 5. decide_bill_approval: only active approvers and admins

select throws_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('reviewer_checks'), '00000000-0000-4000-8000-0000000000b2', 'approve') $$,
    '42501',
    null,
    'an inactive approver cannot decide'
);

select throws_ok(
    $$ select public.decide_bill_approval(pg_temp.pending_approval('reviewer_checks'), '00000000-0000-4000-8000-0000000000a2', 'approve') $$,
    '42501',
    null,
    'an analyst cannot decide'
);

select is(
    (select status from public.bills where bill_id = pg_temp.bill_id('reviewer_checks')),
    'pending_approval',
    'refused reviewers leave the bill pending'
);

-- 6. resubmit_bill_with_approval

select throws_ok(
    $$ select public.resubmit_bill_with_approval(pg_temp.bill_id('reject_me'), pg_temp.bill_fields(200), '00000000-0000-4000-8000-0000000000a2') $$,
    '42501',
    null,
    'only the submitter can resubmit a rejected bill'
);

select throws_ok(
    $$ select public.resubmit_bill_with_approval(pg_temp.bill_id('b4999'), pg_temp.bill_fields(200), '00000000-0000-4000-8000-0000000000a1') $$,
    'P0001',
    null,
    'an approved bill cannot be resubmitted'
);

select throws_ok(
    $$ select public.resubmit_bill_with_approval(pg_temp.bill_id('reviewer_checks'), pg_temp.bill_fields(200), '00000000-0000-4000-8000-0000000000a1') $$,
    'P0001',
    null,
    'a pending bill cannot be resubmitted'
);

select throws_ok(
    $$ select public.resubmit_bill_with_approval(gen_random_uuid(), pg_temp.bill_fields(200), '00000000-0000-4000-8000-0000000000a1') $$,
    'P0002',
    null,
    'a missing bill cannot be resubmitted'
);

select is(
    public.resubmit_bill_with_approval(pg_temp.bill_id('reject_me'), pg_temp.bill_fields(200), '00000000-0000-4000-8000-0000000000a1'),
    pg_temp.bill_id('reject_me'),
    'the submitter can resubmit their rejected bill'
);

select results_eq(
    $$ select approval_status, comments from public.approvals
       where bill_id = pg_temp.bill_id('reject_me') order by approval_status $$,
    $$ values ('pending'::text, null::text), ('rejected'::text, 'Wrong amount'::text) $$,
    'resubmitting keeps the rejected approval and adds a pending one'
);

select results_eq(
    $$ select status, amount from public.bills where bill_id = pg_temp.bill_id('reject_me') $$,
    $$ values ('pending_approval'::text, 200.00::numeric) $$,
    'resubmitting updates the bill and sends it for approval'
);

-- 7. submit_draft_bill_with_approval

with draft as (
    insert into public.bills (submitted_by, amount)
    values ('00000000-0000-4000-8000-0000000000a1', 1.00)
    returning bill_id
)
insert into fixture_bills
select 'draft', bill_id from draft;

select throws_ok(
    $$ select public.submit_draft_bill_with_approval(pg_temp.bill_id('draft'), pg_temp.bill_fields(300), '00000000-0000-4000-8000-0000000000a2') $$,
    '42501',
    null,
    'another user cannot submit the draft'
);

select throws_ok(
    $$ select public.submit_draft_bill_with_approval(gen_random_uuid(), pg_temp.bill_fields(300), '00000000-0000-4000-8000-0000000000a1') $$,
    'P0002',
    null,
    'a missing draft cannot be submitted'
);

select is(
    public.submit_draft_bill_with_approval(pg_temp.bill_id('draft'), pg_temp.bill_fields(300), '00000000-0000-4000-8000-0000000000a1'),
    pg_temp.bill_id('draft'),
    'the owner can submit their draft'
);

select throws_ok(
    $$ select public.submit_draft_bill_with_approval(pg_temp.bill_id('draft'), pg_temp.bill_fields(300), '00000000-0000-4000-8000-0000000000a1') $$,
    'P0001',
    null,
    'a draft cannot be submitted twice'
);

select results_eq(
    $$ select b.status, b.amount, count(a.*)
       from public.bills b join public.approvals a using (bill_id)
       where b.bill_id = pg_temp.bill_id('draft') and a.approval_status = 'pending'
       group by b.status, b.amount $$,
    $$ values ('pending_approval'::text, 300.00::numeric, 1::bigint) $$,
    'submitting a draft sends it for approval with one pending approval'
);

select * from finish();

rollback;

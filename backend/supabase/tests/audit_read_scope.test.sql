-- Who may read the audit log, and that reading it does not let anyone write it
-- (migration 20261110180100_audit_trail_read_policy).
-- Runs in one transaction that rolls back.

begin;

select plan(28);

-- 1. WIRING

select has_function('audit', 'can_read', array['uuid', 'bigint'], 'audit.can_read(uuid, bigint) exists');

select is(
    (select count(*)::int from pg_policies
     where schemaname = 'audit' and tablename = 'record_changes'),
    1,
    'the log has one policy'
);

select is(
    has_function_privilege('authenticated', 'audit.can_read(uuid, bigint)', 'execute'),
    true,
    'a signed-in user can call audit.can_read'
);

select is(
    has_function_privilege('anon', 'audit.can_read(uuid, bigint)', 'execute'),
    false,
    'an anonymous user cannot call audit.can_read'
);

-- 2. FIXTURES

-- Users: admin ...a1, analyst ...b1, analyst ...b2, approver ...c1 and an
-- inactive admin ...d1. Signup creates inactive analysts.
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000a1', 'admin@example.com'),
    ('00000000-0000-4000-8000-0000000000b1', 'author@example.com'),
    ('00000000-0000-4000-8000-0000000000b2', 'other.analyst@example.com'),
    ('00000000-0000-4000-8000-0000000000c1', 'approver@example.com'),
    ('00000000-0000-4000-8000-0000000000d1', 'inactive.admin@example.com');

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

-- Bills: ...01 submitted by ...b1, ...03 a draft of ...b1, ...04 submitted by
-- ...b2. The vendor gives a log row that belongs to no bill.
insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status
)
values
    ('10000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-0000000000b1',
     'INV-1', '2026-11-01', '2026-12-01', 10.00, '111111', 'pending_approval'),
    ('10000000-0000-4000-8000-000000000003',
     '00000000-0000-4000-8000-0000000000b1',
     'INV-3', '2026-11-01', '2026-12-01', 10.00, '999999', 'draft'),
    ('10000000-0000-4000-8000-000000000004',
     '00000000-0000-4000-8000-0000000000b2',
     'INV-4', '2026-11-01', '2026-12-01', 10.00, '888888', 'pending_approval');

insert into public.vendors (vendor_id, vendor_name, contact_email)
values ('30000000-0000-4000-8000-000000000001', 'City Water', 'bills@citywater.example');

-- Bill ...05: ...b1 inserts it as a draft, adds an approval, edits it, then
-- submits it, and an approval follows. The first three log rows were written
-- while it was a draft; the last two after it was submitted.
insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status
)
values (
    '10000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-0000000000b1',
    'INV-5', '2026-11-01', '2026-12-01', 10.00, '555555', 'draft'
);
insert into public.approvals (bill_id)
values ('10000000-0000-4000-8000-000000000005');
update public.bills set amount = 12.50
where bill_id = '10000000-0000-4000-8000-000000000005';
update public.bills set status = 'pending_approval'
where bill_id = '10000000-0000-4000-8000-000000000005';
insert into public.approvals (bill_id)
values ('10000000-0000-4000-8000-000000000005');

select set_config(
    't.total', (select count(*) from audit.record_changes)::text, true
);

-- 3. WHO MAY READ THE LOG

set local role authenticated;
select set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000a1"}',
    true
);

select is(
    (select count(*)::int from audit.record_changes),
    current_setting('t.total')::int,
    'an active admin reads the whole log'
);

select cmp_ok(
    (select count(*)::int from audit.record_changes where bill_id is null),
    '>',
    0,
    'an active admin reads rows that belong to no bill'
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000003'),
    1,
    'an admin reads the log of any bill, drafts included'
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000005'),
    5,
    'an admin reads the draft-time log of a submitted bill'
);

select set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000d1"}',
    true
);

select is(
    (select count(*)::int from audit.record_changes),
    0,
    'an inactive admin reads nothing'
);

select set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000b1"}',
    true
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000003'),
    1,
    'an analyst reads the log of their own draft'
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000005'),
    5,
    'an analyst reads the draft-time log of their own submitted bill'
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000004'),
    1,
    'an analyst reads the log of a bill another analyst submitted'
);

select is(
    (select count(*)::int from audit.record_changes where bill_id is null),
    0,
    'an analyst reads no row that belongs to no bill'
);

select set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000b2"}',
    true
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000003'),
    0,
    'an analyst never reads the log of another analyst''s draft'
);

select cmp_ok(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000001'),
    '>',
    0,
    'an analyst reads the log of a submitted bill'
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000005'),
    2,
    'an analyst reads only the post-submit log of another analyst''s bill, never its draft-time rows'
);

select set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000c1"}',
    true
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000003'),
    0,
    'an approver never reads the log of an analyst''s draft'
);

select cmp_ok(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000004'),
    '>',
    0,
    'an approver reads the log of a submitted bill'
);

select is(
    (select count(*)::int from audit.record_changes
     where bill_id = '10000000-0000-4000-8000-000000000005'),
    2,
    'an approver reads only the post-submit log of a bill, never its draft-time rows'
);

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);

select is(
    (select count(*)::int from audit.record_changes),
    0,
    'a token with no matching user reads nothing'
);

reset role;

-- 4. THE BACKEND'S ROLE READS EVERYTHING (it applies bill_access itself)

select set_config('request.jwt.claims', '', true);
set local role service_role;

select is(
    (select count(*)::int from audit.record_changes),
    current_setting('t.total')::int,
    'the service role reads the whole log'
);

-- 5. READING DOES NOT LET ANYONE WRITE

select throws_ok(
    $$ insert into audit.record_changes (table_schema, table_name, op)
       values ('public', 'bills', 'INSERT') $$,
    '42501', null, 'the service role cannot write a log row'
);
select throws_ok(
    $$ update audit.record_changes set actor_id = null $$,
    '42501', null, 'the service role cannot update the log'
);
select throws_ok(
    $$ delete from audit.record_changes $$,
    '42501', null, 'the service role cannot delete from the log'
);

reset role;
set local role authenticated;

select throws_ok(
    $$ insert into audit.record_changes (table_schema, table_name, op)
       values ('public', 'bills', 'INSERT') $$,
    '42501', null, 'a signed-in user cannot write a log row'
);
select throws_ok(
    $$ update audit.record_changes set actor_id = null $$,
    '42501', null, 'a signed-in user cannot update the log'
);
select throws_ok(
    $$ delete from audit.record_changes $$,
    '42501', null, 'a signed-in user cannot delete from the log'
);

reset role;
set local role anon;

select throws_ok(
    $$ select count(*) from audit.record_changes $$,
    '42501', null, 'an anonymous user cannot read the log'
);

reset role;

select * from finish();

rollback;

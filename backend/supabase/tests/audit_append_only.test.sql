-- Nothing can edit or erase the audit log, and TRUNCATE is refused on
-- audit_events too (migration 20261110180000_create_audit_trail, section 6).
-- Runs in one transaction that rolls back.

begin;

select plan(12);

select has_trigger(
    'audit', 'record_changes', 'prevent_audit_mutation',
    'the log refuses row updates and deletes'
);
select has_trigger(
    'audit', 'record_changes', 'prevent_audit_truncate',
    'the log refuses TRUNCATE'
);
select has_trigger(
    'public', 'audit_events', 'prevent_audit_events_truncate',
    'audit_events refuses TRUNCATE'
);

-- A log row for the guards to act on (a bill insert writes one), and an
-- audit_events row for the guards on that table.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000b1', 'author@example.com');

insert into public.bills (
    bill_id, submitted_by, invoice_number, invoice_date, due_date, amount,
    account_number_raw, status
)
values (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000b1',
    'INV-1', '2026-11-01', '2026-12-01', 100.00, '1234567890', 'draft'
);

insert into public.audit_events (bill_id, action, new_status)
values ('10000000-0000-4000-8000-000000000001', 'bill_created', 'draft');

select throws_ok(
    $$ update audit.record_changes set actor_id = null $$,
    'P0001',
    'Audit records cannot be modified, deleted or truncated',
    'an update of the log is refused, even for its owner'
);

select throws_ok(
    $$ delete from audit.record_changes $$,
    'P0001',
    'Audit records cannot be modified, deleted or truncated',
    'a delete from the log is refused, even for its owner'
);

select throws_ok(
    $$ truncate audit.record_changes $$,
    'P0001',
    'Audit records cannot be modified, deleted or truncated',
    'truncating the log is refused, even for its owner'
);

select throws_ok(
    $$ truncate public.audit_events $$,
    'P0001',
    'Audit records cannot be modified, deleted or truncated',
    'truncating audit_events is refused, even for its owner'
);

select throws_ok(
    $$ delete from public.audit_events $$,
    'P0001',
    'Audit events cannot be modified or deleted',
    'a delete from audit_events is still refused'
);

-- The API roles are refused before the guard is reached, or by the guard.
set local role service_role;

select throws_ok(
    $$ truncate audit.record_changes $$,
    '42501', null, 'the service role cannot truncate the log'
);
select throws_ok(
    $$ truncate public.audit_events $$,
    'P0001',
    'Audit records cannot be modified, deleted or truncated',
    'the service role cannot truncate audit_events'
);
select throws_ok(
    $$ update public.audit_events set details = 'x' $$,
    'P0001',
    'Audit events cannot be modified or deleted',
    'the service role cannot update audit_events'
);

reset role;
set local role authenticated;

select throws_ok(
    $$ select audit.capture() $$,
    '42501', null, 'a signed-in user cannot call the trigger function'
);

reset role;

select * from finish();

rollback;

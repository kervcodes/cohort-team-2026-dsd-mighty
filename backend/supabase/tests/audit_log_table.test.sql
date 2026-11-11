-- The audit log table exists and no API role can touch it
-- (migration 20261110180000_create_audit_trail, section 1).
-- Runs in one transaction that rolls back.

begin;

select plan(14);

select has_schema('audit', 'the audit schema exists');
select has_table('audit', 'record_changes', 'audit.record_changes exists');

select columns_are(
    'audit',
    'record_changes',
    array[
        'id', 'table_schema', 'table_name', 'op', 'record_pk', 'bill_id',
        'old_row', 'new_row', 'changed_cols', 'actor_id', 'actor_role',
        'txid', 'occurred_at'
    ],
    'the log has the columns the triggers write'
);

select throws_ok(
    $$ insert into audit.record_changes (table_schema, table_name, op)
       values ('public', 'bills', 'MERGE') $$,
    '23514',
    null,
    'an operation other than INSERT, UPDATE or DELETE is refused'
);

select is(
    (select count(*)::int from information_schema.table_privileges
     where table_schema = 'audit'
        and table_name = 'record_changes'
        and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
    0,
    'no API role holds a privilege on the log'
);

set local role service_role;

select throws_ok(
    $$ insert into audit.record_changes (table_schema, table_name, op)
       values ('public', 'bills', 'INSERT') $$,
    '42501', null, 'the service role cannot write a log row'
);
select throws_ok(
    $$ select count(*) from audit.record_changes $$,
    '42501', null, 'the service role cannot read the log directly'
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
    $$ select count(*) from audit.record_changes $$,
    '42501', null, 'a signed-in user cannot read the log directly'
);
select throws_ok(
    $$ truncate audit.record_changes $$,
    '42501', null, 'a signed-in user cannot truncate the log'
);

reset role;
set local role anon;

select throws_ok(
    $$ select count(*) from audit.record_changes $$,
    '42501', null, 'an anonymous user cannot read the log'
);
select throws_ok(
    $$ insert into audit.record_changes (table_schema, table_name, op)
       values ('public', 'bills', 'INSERT') $$,
    '42501', null, 'an anonymous user cannot write a log row'
);

reset role;

select * from finish();

rollback;

-- The hand-made test_connection table is gone
-- (migration 20261111200000_drop_test_connection).
-- Runs in one transaction that rolls back.

begin;

select plan(1);

select hasnt_table(
    'public', 'test_connection',
    'public.test_connection does not exist'
);

select * from finish();

rollback;

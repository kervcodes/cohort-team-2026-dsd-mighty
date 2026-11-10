-- The invoices bucket is private and only the service role can touch its
-- files (migration 20261104170000_create_invoices_bucket).
-- Runs in one transaction that rolls back.

begin;

select plan(6);

-- 1. BUCKET

select ok(
    exists (select 1 from storage.buckets where id = 'invoices'),
    'the invoices bucket exists'
);

select is(
    (select public from storage.buckets where id = 'invoices'),
    false,
    'the invoices bucket is private'
);

-- 2. NO ACCESS FOR BROWSER ROLES

-- A file as the backend would store it (as the table owner, like the
-- service role, bypassing RLS).
insert into storage.objects (bucket_id, name)
values ('invoices', 'bills/test/invoice.pdf');

set local role authenticated;

select is(
    (select count(*)::int from storage.objects where bucket_id = 'invoices'),
    0,
    'a signed-in user cannot see invoice files'
);

select throws_ok(
    $$ insert into storage.objects (bucket_id, name)
       values ('invoices', 'bills/test/other.pdf') $$,
    '42501',
    null,
    'a signed-in user cannot upload invoice files'
);

reset role;
set local role anon;

select is(
    (select count(*)::int from storage.objects where bucket_id = 'invoices'),
    0,
    'an anonymous user cannot see invoice files'
);

select throws_ok(
    $$ insert into storage.objects (bucket_id, name)
       values ('invoices', 'bills/test/anon.pdf') $$,
    '42501',
    null,
    'an anonymous user cannot upload invoice files'
);

reset role;

select * from finish();

rollback;

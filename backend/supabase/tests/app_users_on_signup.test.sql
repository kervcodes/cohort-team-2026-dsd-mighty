-- Supabase Auth users and public.app_users stay in step
-- (migration 20261102050250_create_app_user_on_signup).
-- Runs in one transaction that rolls back.

begin;

select plan(41);

-- 1. TRIGGER WIRING

select has_trigger(
    'auth', 'users', 'on_auth_user_created',
    'auth.users has the on_auth_user_created trigger'
);

select trigger_is(
    'auth', 'users', 'on_auth_user_created',
    'public', 'handle_new_auth_user',
    'on_auth_user_created calls public.handle_new_auth_user'
);

select has_trigger(
    'auth', 'users', 'on_auth_user_email_updated',
    'auth.users has the on_auth_user_email_updated trigger'
);

select trigger_is(
    'auth', 'users', 'on_auth_user_email_updated',
    'public', 'handle_auth_user_email_updated',
    'on_auth_user_email_updated calls public.handle_auth_user_email_updated'
);

-- 2. FULL NAME RULE

select is(
    public.app_user_full_name('ada@example.com', '{"full_name": "Ada Lovelace"}'),
    'Ada Lovelace',
    'full_name comes from metadata'
);

select is(
    public.app_user_full_name('ada@example.com', '{"full_name": "  Ada Lovelace  "}'),
    'Ada Lovelace',
    'metadata full_name is trimmed'
);

select is(
    public.app_user_full_name('blank.name@example.com', '{"full_name": "   "}'),
    'blank.name',
    'blank metadata full_name falls back to the email local part'
);

select is(
    public.app_user_full_name('null.name@example.com', '{"full_name": null}'),
    'null.name',
    'null metadata full_name falls back to the email local part'
);

select is(
    public.app_user_full_name('no.metadata@example.com', null),
    'no.metadata',
    'missing metadata falls back to the email local part'
);

-- 3. SIGNUP WITHOUT METADATA

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000001', 'plain.user@example.com');

select results_eq(
    $$
        select user_id, email, full_name, role, status
        from public.app_users
        where user_id = '00000000-0000-4000-8000-000000000001'
    $$,
    $$
        values (
            '00000000-0000-4000-8000-000000000001'::uuid,
            'plain.user@example.com'::text,
            'plain.user'::text,
            'analyst'::text,
            'inactive'::text
        )
    $$,
    'signup creates an inactive analyst named after the email local part'
);

-- 4. METADATA CANNOT GRANT A ROLE OR STATUS

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-000000000002',
    'would.be.admin@example.com',
    '{"role": "admin", "status": "active", "full_name": "  Ada Lovelace  "}'
);

select results_eq(
    $$
        select full_name, role, status
        from public.app_users
        where user_id = '00000000-0000-4000-8000-000000000002'
    $$,
    $$ values ('Ada Lovelace'::text, 'analyst'::text, 'inactive'::text) $$,
    'signup takes full_name from metadata but ignores metadata role and status'
);

-- 5. AN EXISTING APP USER ROW IS KEPT

-- No statement order makes the trigger see this row first:
-- an unreferenced data-modifying CTE runs after the main
-- insert. It works because the AFTER ROW trigger and the
-- foreign key check both fire at the end of the statement,
-- once both rows exist.

select lives_ok(
    $$
        with existing as (
            insert into public.app_users (user_id, full_name, email, role, status)
            values (
                '00000000-0000-4000-8000-000000000006',
                'Existing Admin',
                'existing@example.com',
                'admin',
                'active'
            )
        )
        insert into auth.users (id, email, raw_user_meta_data)
        values (
            '00000000-0000-4000-8000-000000000006',
            'existing@example.com',
            '{"full_name": "New Name"}'
        )
    $$,
    'signup succeeds when the app_users row already exists'
);

select results_eq(
    $$
        select full_name, role, status
        from public.app_users
        where user_id = '00000000-0000-4000-8000-000000000006'
    $$,
    $$ values ('Existing Admin'::text, 'admin'::text, 'active'::text) $$,
    'an existing app_users row is not overwritten'
);

-- 6. EMAIL SYNC

update auth.users
set email = 'plain.renamed@example.com'
where id = '00000000-0000-4000-8000-000000000001';

select is(
    (select email from public.app_users
     where user_id = '00000000-0000-4000-8000-000000000001'),
    'plain.renamed@example.com',
    'app_users.email follows an auth email change'
);

select lives_ok(
    $$
        insert into auth.users (id, email)
        values (
            '00000000-0000-4000-8000-000000000008',
            'plain.user@example.com'
        )
    $$,
    'a new signup can reuse an email another user changed away from'
);

select is(
    (select email from public.app_users
     where user_id = '00000000-0000-4000-8000-000000000008'),
    'plain.user@example.com',
    'the new signup has its own app_users row'
);

update auth.users
set raw_user_meta_data = '{"full_name": "Changed"}'
where id = '00000000-0000-4000-8000-000000000006';

select is(
    (select email from public.app_users
     where user_id = '00000000-0000-4000-8000-000000000006'),
    'existing@example.com',
    'an auth update that keeps the email leaves app_users.email alone'
);

-- 7. AUTH USER DELETES

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000009', 'leaving@example.com');

select lives_ok(
    $$
        delete from auth.users
        where id = '00000000-0000-4000-8000-000000000009'
    $$,
    'an auth user without bills can be deleted'
);

select is_empty(
    $$
        select 1 from public.app_users
        where user_id = '00000000-0000-4000-8000-000000000009'
    $$,
    'deleting an auth user without bills removes its app_users row'
);

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000010', 'has.bills@example.com');

insert into public.bills (
    property_address, account_status, website_name, submitted_by,
    invoice_number, invoice_date, due_date, amount, account_number_raw
)
values (
    '1 Main St', 'active', 'example.com',
    '00000000-0000-4000-8000-000000000010',
    'INV-1', '2026-11-01', '2026-11-30', 10.00, 'ACCT-1'
);

select throws_ok(
    $$
        delete from auth.users
        where id = '00000000-0000-4000-8000-000000000010'
    $$,
    '23503',
    null,
    'an auth user whose app_users row submitted a bill cannot be deleted'
);

select is(
    (select confdeltype from pg_catalog.pg_constraint
     where conname = 'bills_submitted_by_fkey'
         and conrelid = 'public.bills'::regclass),
    'a'::"char",
    'bills.submitted_by does not cascade or null out on delete'
);

-- 8. FUNCTION SECURITY

select is(
    (select prosecdef from pg_catalog.pg_proc
     where oid = 'public.handle_new_auth_user()'::regprocedure),
    true,
    'handle_new_auth_user is security definer'
);

select is(
    (select proconfig from pg_catalog.pg_proc
     where oid = 'public.handle_new_auth_user()'::regprocedure),
    array['search_path=""'],
    'handle_new_auth_user pins an empty search_path'
);

select is(
    (select prosecdef from pg_catalog.pg_proc
     where oid = 'public.handle_auth_user_email_updated()'::regprocedure),
    true,
    'handle_auth_user_email_updated is security definer'
);

select is(
    (select proconfig from pg_catalog.pg_proc
     where oid = 'public.handle_auth_user_email_updated()'::regprocedure),
    array['search_path=""'],
    'handle_auth_user_email_updated pins an empty search_path'
);

select is(
    (select prosecdef from pg_catalog.pg_proc
     where oid = 'public.app_user_full_name(text, jsonb)'::regprocedure),
    false,
    'app_user_full_name is security invoker'
);

select is(
    (select proconfig from pg_catalog.pg_proc
     where oid = 'public.app_user_full_name(text, jsonb)'::regprocedure),
    array['search_path=""'],
    'app_user_full_name pins an empty search_path'
);

select is(
    (select provolatile from pg_catalog.pg_proc
     where oid = 'public.app_user_full_name(text, jsonb)'::regprocedure),
    'i'::"char",
    'app_user_full_name is immutable'
);

select ok(
    not has_function_privilege(
        'anon', 'public.handle_new_auth_user()', 'execute'
    ),
    'anon cannot execute handle_new_auth_user'
);

select ok(
    not has_function_privilege(
        'authenticated', 'public.handle_new_auth_user()', 'execute'
    ),
    'authenticated cannot execute handle_new_auth_user'
);

select ok(
    not has_function_privilege(
        'anon', 'public.handle_auth_user_email_updated()', 'execute'
    ),
    'anon cannot execute handle_auth_user_email_updated'
);

select ok(
    not has_function_privilege(
        'authenticated', 'public.handle_auth_user_email_updated()', 'execute'
    ),
    'authenticated cannot execute handle_auth_user_email_updated'
);

select ok(
    not has_function_privilege(
        'anon', 'public.app_user_full_name(text, jsonb)', 'execute'
    ),
    'anon cannot execute app_user_full_name'
);

select ok(
    not has_function_privilege(
        'authenticated', 'public.app_user_full_name(text, jsonb)', 'execute'
    ),
    'authenticated cannot execute app_user_full_name'
);

-- A null proacl means the default grant to PUBLIC.
select is_empty(
    $$
        select p.oid::regprocedure
        from pg_catalog.pg_proc as p,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
        where p.oid in (
                'public.handle_new_auth_user()'::regprocedure,
                'public.handle_auth_user_email_updated()'::regprocedure,
                'public.app_user_full_name(text, jsonb)'::regprocedure
            )
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
    $$,
    'PUBLIC cannot execute the app user functions'
);

-- 9. EVERY AUTH USER HAS AN APP USER

select is_empty(
    $$
        select u.id
        from auth.users as u
        where not exists (
            select 1 from public.app_users as a where a.user_id = u.id
        )
    $$,
    'no auth user lacks an app_users row'
);

-- 10. RE-RUN THE MIGRATION (BACKFILL)

-- Simulate a user who signed up before the trigger existed,
-- then run every statement of the applied migration again,
-- as recorded by the Supabase CLI.

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-000000000011',
    'early.bird@example.com',
    '{"full_name": "  Early Bird  ", "role": "admin", "status": "active"}'
);

delete from public.app_users
where user_id = '00000000-0000-4000-8000-000000000011';

select lives_ok(
    $$
        do $do$
        declare
            stmt text;
        begin
            for stmt in
                select unnest(statements)
                from supabase_migrations.schema_migrations
                where version = '20261102050250'
            loop
                execute stmt;
            end loop;
        end;
        $do$
    $$,
    'the migration runs again on a database that already has it'
);

select results_eq(
    $$
        select email, full_name, role, status
        from public.app_users
        where user_id = '00000000-0000-4000-8000-000000000011'
    $$,
    $$
        values (
            'early.bird@example.com'::text,
            'Early Bird'::text,
            'analyst'::text,
            'inactive'::text
        )
    $$,
    'the backfill creates an inactive analyst for a user without a row'
);

select results_eq(
    $$
        select full_name, role, status
        from public.app_users
        where user_id = '00000000-0000-4000-8000-000000000006'
    $$,
    $$ values ('Existing Admin'::text, 'admin'::text, 'active'::text) $$,
    'the backfill leaves existing app_users rows alone'
);

select is(
    (select count(*)::int from pg_catalog.pg_trigger
     where tgrelid = 'auth.users'::regclass
         and tgname in ('on_auth_user_created', 'on_auth_user_email_updated')),
    2,
    'a re-run leaves one of each trigger'
);

-- 11. NO EMAIL FAILS THE SIGNUP

select throws_ok(
    $$
        insert into auth.users (id, phone)
        values ('00000000-0000-4000-8000-000000000007', '15555550100')
    $$,
    '23502',
    null,
    'a user without an email cannot be created'
);

select * from finish();

rollback;

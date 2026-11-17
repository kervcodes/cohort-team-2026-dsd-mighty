-- audit.actor_id() names who made a change, and only trusts the
-- X-Audit-Actor-Id header from the service role
-- (migration 20261110180000_create_audit_trail, section 2).
-- Runs in one transaction that rolls back.

begin;

select plan(15);

-- Users the function may be asked about do not need to exist: it only reads
-- settings and returns a uuid.

select is(
    (select count(*)::int
     from unnest(array['anon', 'authenticated', 'service_role']) as r(role_name)
     where has_function_privilege(r.role_name, 'audit.actor_id()', 'execute')),
    0,
    'no API role can call audit.actor_id()'
);

select is(audit.actor_id(), null, 'with nothing set, there is no actor');

-- The API's service-role client: no signed-in user in auth.uid(), the actor
-- in the request header.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select set_config(
    'request.headers',
    '{"x-audit-actor-id": "00000000-0000-4000-8000-0000000000b1", "accept": "*/*"}',
    true
);

select is(
    audit.actor_id(),
    '00000000-0000-4000-8000-0000000000b1'::uuid,
    'a service-role request names its actor in the header'
);

select set_config(
    'request.headers',
    '{"X-Audit-Actor-Id": "00000000-0000-4000-8000-0000000000C1"}',
    true
);

select is(
    audit.actor_id(),
    '00000000-0000-4000-8000-0000000000c1'::uuid,
    'the header name and the uuid are matched whatever their case'
);

select set_config('request.headers', '{"x-audit-actor-id": "not-a-uuid"}', true);

select lives_ok(
    $$ select audit.actor_id() $$,
    'a malformed actor header does not raise'
);
select is(audit.actor_id(), null, 'a malformed actor header names no actor');

select set_config('request.headers', '{"accept": "*/*"}', true);

select is(audit.actor_id(), null, 'a service-role request with no header has no actor');

-- A browser role must not name someone else.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config(
    'request.headers',
    '{"x-audit-actor-id": "00000000-0000-4000-8000-0000000000a1"}',
    true
);

select is(audit.actor_id(), null, 'the header is ignored for the anon role');

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);

select is(audit.actor_id(), null, 'the header is ignored for a signed-in role');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select set_config('request.headers', 'not json', true);

select lives_ok(
    $$ select audit.actor_id() $$,
    'unreadable request headers do not raise'
);
select is(audit.actor_id(), null, 'unreadable request headers name no actor');

-- A signed-in user wins over the header.
select set_config(
    'request.jwt.claims',
    '{"role": "service_role", "sub": "00000000-0000-4000-8000-0000000000a1"}',
    true
);
select set_config(
    'request.headers',
    '{"x-audit-actor-id": "00000000-0000-4000-8000-0000000000c1"}',
    true
);

select is(
    audit.actor_id(),
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    'auth.uid() wins over the header'
);

-- Scripts and direct SQL: an app.actor_id setting in the transaction.
select set_config('request.jwt.claims', '', true);
select set_config('request.headers', '', true);
select set_config('app.actor_id', '00000000-0000-4000-8000-0000000000b2', true);

select is(
    audit.actor_id(),
    '00000000-0000-4000-8000-0000000000b2'::uuid,
    'the app.actor_id setting names the actor for direct SQL'
);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select set_config(
    'request.headers',
    '{"x-audit-actor-id": "00000000-0000-4000-8000-0000000000c1"}',
    true
);

select is(
    audit.actor_id(),
    '00000000-0000-4000-8000-0000000000b2'::uuid,
    'app.actor_id wins over the header'
);

select set_config('app.actor_id', 'not-a-uuid', true);

select is(audit.actor_id(), null, 'a malformed app.actor_id names no actor');

select * from finish();

rollback;

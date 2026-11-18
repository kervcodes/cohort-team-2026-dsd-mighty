-- Reading the audit log through the API (DC-89): the functions behind
-- GET /audit/changes and GET /bills/{bill_id}/history.
--
-- The log (audit.record_changes, migration 20261110180000_create_audit_trail)
-- lives in the audit schema, which PostgREST does not expose. These public
-- functions are the backend's only way to read it: only the service role may
-- call them, and the backend serves them to active admins only.
--
-- Rows come back as stored, with old_row and new_row passed through
-- audit.mask once more. They were masked when they were written; masking
-- again is a no-op for those values and covers rows written before a column
-- joined the masked list (portal_password_secret_id,
-- 20261118100500_audit_mask_portal_secret_id). Nothing here unmasks or adds
-- to a row.
-- The only extra column is the actor's current full name from app_users (null
-- when there is no actor or the user is gone).
--
-- security definer and search_path: as in
-- 20261102050250_create_app_user_on_signup.

-- 1. A PAGE OF CHANGES (GET /audit/changes)

-- Newest first (id descending). Every filter is optional:
--   p_table      one audited table
--   p_actor_id   changes made by this user
--   p_bill_id    changes that belong to this bill
--   p_from       occurred_at on or after this UTC day
--   p_to         occurred_at on or before this UTC day (inclusive)
--   p_before_id  keyset paging: only rows with id < p_before_id
--   p_limit      page size, 1..100
--
-- has_more is the same on every row: whether another, older row matches
-- after this page (the caller then passes the last id as p_before_id).
create function public.audit_changes(
    p_table text default null,
    p_actor_id uuid default null,
    p_bill_id uuid default null,
    p_from date default null,
    p_to date default null,
    p_before_id bigint default null,
    p_limit integer default 50
)
returns table (
    id bigint,
    table_name text,
    op text,
    record_pk jsonb,
    bill_id uuid,
    old_row jsonb,
    new_row jsonb,
    changed_cols text[],
    actor_id uuid,
    actor_role text,
    actor_name text,
    occurred_at timestamptz,
    has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception 'limit must be between 1 and 100'
            using errcode = '22023';
    end if;

    if p_table is not null and p_table not in (
        'bills',
        'approvals',
        'payments',
        'vendors',
        'vendor_accounts',
        'properties',
        'app_users',
        'autopay_settings'
    ) then
        raise exception 'unknown audited table: %', p_table
            using errcode = '22023';
    end if;

    -- One row more than the page, to tell whether another page follows.
    return query
    with candidates as (
        select r.*
        from audit.record_changes as r
        where r.table_schema = 'public'
            and (p_table is null or r.table_name = p_table)
            and (p_actor_id is null or r.actor_id = p_actor_id)
            and (p_bill_id is null or r.bill_id = p_bill_id)
            and (
                p_from is null
                or r.occurred_at >= p_from::timestamp at time zone 'UTC'
            )
            and (
                p_to is null
                or r.occurred_at < (p_to + 1)::timestamp at time zone 'UTC'
            )
            and (p_before_id is null or r.id < p_before_id)
        order by r.id desc
        limit p_limit + 1
    )
    select
        c.id,
        c.table_name,
        c.op,
        c.record_pk,
        c.bill_id,
        audit.mask(c.old_row),
        audit.mask(c.new_row),
        c.changed_cols,
        c.actor_id,
        c.actor_role,
        u.full_name,
        c.occurred_at,
        (select count(*) from candidates) > p_limit
    from candidates as c
    left join public.app_users as u
        on u.user_id = c.actor_id
    order by c.id desc
    limit p_limit;
end;
$$;

-- 2. EVERY CHANGE OF ONE BILL (GET /bills/{bill_id}/history)

-- Oldest first (id ascending): the bill's own rows and those of its
-- approvals and payments. A bill has a handful of rows, so there is no paging.
create function public.audit_bill_changes(p_bill_id uuid)
returns table (
    id bigint,
    table_name text,
    op text,
    record_pk jsonb,
    bill_id uuid,
    old_row jsonb,
    new_row jsonb,
    changed_cols text[],
    actor_id uuid,
    actor_role text,
    actor_name text,
    occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if p_bill_id is null then
        raise exception 'bill id is required'
            using errcode = '22023';
    end if;

    return query
    select
        r.id,
        r.table_name,
        r.op,
        r.record_pk,
        r.bill_id,
        audit.mask(r.old_row),
        audit.mask(r.new_row),
        r.changed_cols,
        r.actor_id,
        r.actor_role,
        u.full_name,
        r.occurred_at
    from audit.record_changes as r
    left join public.app_users as u
        on u.user_id = r.actor_id
    where r.table_schema = 'public'
        and r.bill_id = p_bill_id
    order by r.id;
end;
$$;

-- 3. ACCESS

-- Supabase's default privileges grant new public functions to anon and
-- authenticated; only the backend (service role) may read the log this way.
revoke execute on function public.audit_changes(
    text, uuid, uuid, date, date, bigint, integer
)
from public, anon, authenticated;

grant execute on function public.audit_changes(
    text, uuid, uuid, date, date, bigint, integer
)
to service_role;

revoke execute on function public.audit_bill_changes(uuid)
from public, anon, authenticated;

grant execute on function public.audit_bill_changes(uuid)
to service_role;

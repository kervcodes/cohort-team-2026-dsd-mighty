-- Audit trail: a database-level change log (audit.record_changes).
--
-- Triggers write one row for every insert, update and delete on the bill
-- workflow tables, so no code path (API route, SQL console, script) can change
-- them without leaving a trace. public.audit_events stays as the business
-- timeline; this is the row-level log underneath it.
--
-- The migration reads in order: the table, who made the change, masking, the
-- triggers that write rows, then the guards that keep the log append-only.
-- Who may read the log is a separate migration
-- (20261110180100_audit_trail_read_policy).

-- 1. THE LOG TABLE

-- Not exposed through the API: the schema is not in config.toml [api] schemas.
create schema if not exists audit;

revoke all on schema audit from public, anon, authenticated, service_role;

create table audit.record_changes (
    id bigint generated always as identity primary key,

    table_schema text not null,
    table_name text not null,
    op text not null
        check (op in ('INSERT', 'UPDATE', 'DELETE')),

    -- The changed row's primary key, e.g. {"bill_id": "..."}.
    record_pk jsonb,

    -- The bill this row belongs to (the bill itself, or a row that
    -- references one). null for vendors, properties and the like. It scopes
    -- who may read the row.
    bill_id uuid,

    -- Full before and after rows, sensitive columns masked. old_row is null
    -- for an insert, new_row for a delete.
    old_row jsonb,
    new_row jsonb,
    -- The columns whose value changed (updates only), ignoring updated_at.
    changed_cols text[],

    -- Who made the change; no foreign key, so a row outlives its user.
    actor_id uuid,
    -- The database role that made it: 'authenticated', 'service_role', ...
    actor_role text,

    txid bigint not null default txid_current(),
    -- clock_timestamp(), not now(): now() is the start of the transaction, so
    -- every row of one transaction would share it.
    occurred_at timestamptz not null default clock_timestamp()
);

create index idx_record_changes_table_name
    on audit.record_changes(table_name, id);

create index idx_record_changes_bill_id
    on audit.record_changes(bill_id, id)
    where bill_id is not null;

create index idx_record_changes_actor_id
    on audit.record_changes(actor_id)
    where actor_id is not null;

create index idx_record_changes_occurred_at
    on audit.record_changes(occurred_at);

-- Nobody but the owner, through audit.capture() (section 5), writes the log.
-- No role can read it yet either: reading is a separate migration.
revoke all on audit.record_changes from public, anon, authenticated, service_role;
revoke all on all sequences in schema audit
from public, anon, authenticated, service_role;

-- 2. WHO MADE THE CHANGE

-- The FastAPI backend uses the service-role client, so auth.uid() is null for
-- every API write. The backend names the signed-in user in the
-- X-Audit-Actor-Id request header, which PostgREST exposes to the transaction
-- as request.headers, and it applies to that one request only.
--
-- In order: the signed-in user (auth.uid()); an app.actor_id setting
-- (set_config('app.actor_id', ..., true) in a transaction, for scripts and
-- direct SQL); the header, but only when the caller's JWT role is
-- service_role, so a browser role cannot name someone else.
-- Anything that is not a uuid is ignored: a bad header must not fail a write.
create or replace function audit.actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uuid_pattern constant text :=
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    claims jsonb;
    headers jsonb;
    candidate text;
begin
    if auth.uid() is not null then
        return auth.uid();
    end if;

    candidate := nullif(current_setting('app.actor_id', true), '');

    if candidate is null then
        begin
            claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
            headers := nullif(current_setting('request.headers', true), '')::jsonb;
        exception when others then
            return null;
        end;

        if claims ->> 'role' = 'service_role' then
            select h.value
            into candidate
            from jsonb_each_text(headers) as h
            where lower(h.key) = 'x-audit-actor-id'
            limit 1;
        end if;
    end if;

    if candidate ~ uuid_pattern then
        return candidate::uuid;
    end if;

    return null;
end;
$$;

revoke execute on function audit.actor_id()
from public, anon, authenticated, service_role;

-- 3. MASKING

-- Bank, account and tax identifiers must not become a second, weaker copy of
-- the data. null in, null out (the old row of an insert). Matched by column
-- name on every audited table, so a column added later is masked too. The last
-- four characters stay, so an edit still shows.
create or replace function audit.mask(row_data jsonb)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
    select coalesce(
        jsonb_object_agg(
            e.key,
            case
                when e.key in (
                    'account_number',
                    'account_number_raw',
                    'bank_account_number',
                    'routing_number',
                    'tax_id',
                    'ein',
                    'ssn'
                )
                and jsonb_typeof(e.value) = 'string'
                then to_jsonb(
                    '****' || case
                        when length(e.value #>> '{}') > 4
                        then right(e.value #>> '{}', 4)
                        else ''
                    end
                )
                else e.value
            end
        ),
        '{}'::jsonb
    )
    from jsonb_each(row_data) as e;
$$;

revoke execute on function audit.mask(jsonb)
from public, anon, authenticated, service_role;

-- 4. RECORDING A CHANGE

-- One function for every audited table. Trigger arguments:
--   1. the primary key column, e.g. 'bill_id'
--   2. optional: the column holding the bill id, when the table has one
-- security definer: the trigger runs as the caller, which has no privilege on
-- audit.record_changes; the function runs as its owner, the only writer.
create or replace function audit.capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    pk_column text := tg_argv[0];
    bill_column text := tg_argv[1];
    old_json jsonb;
    new_json jsonb;
    row_json jsonb;
    changed text[];
begin
    if tg_op <> 'INSERT' then
        old_json := to_jsonb(old);
    end if;
    if tg_op <> 'DELETE' then
        new_json := to_jsonb(new);
    end if;

    if tg_op = 'UPDATE' then
        -- updated_at is rewritten by set_updated_at() on every update, so it
        -- is left out: an update that changes nothing else changes nothing.
        select coalesce(array_agg(n.key order by n.key), '{}')
        into changed
        from jsonb_each(new_json) as n
        where n.key <> 'updated_at'
            and old_json -> n.key is distinct from n.value;

        if cardinality(changed) = 0 then
            return null;
        end if;
    end if;

    row_json := coalesce(new_json, old_json);

    insert into audit.record_changes (
        table_schema,
        table_name,
        op,
        record_pk,
        bill_id,
        old_row,
        new_row,
        changed_cols,
        actor_id,
        actor_role
    )
    values (
        tg_table_schema,
        tg_table_name,
        tg_op,
        jsonb_build_object(pk_column, row_json -> pk_column),
        (row_json ->> bill_column)::uuid,
        audit.mask(old_json),
        audit.mask(new_json),
        changed,
        audit.actor_id(),
        -- The API caller's role; a direct connection has no JWT, so its login.
        coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
            session_user
        )
    );

    return null;
end;
$$;

revoke execute on function audit.capture()
from public, anon, authenticated, service_role;

-- 5. THE AUDITED TABLES

create trigger audit_bills
after insert or update or delete on public.bills
for each row
execute function audit.capture('bill_id', 'bill_id');

create trigger audit_approvals
after insert or update or delete on public.approvals
for each row
execute function audit.capture('approval_id', 'bill_id');

create trigger audit_payments
after insert or update or delete on public.payments
for each row
execute function audit.capture('payment_id', 'bill_id');

create trigger audit_vendors
after insert or update or delete on public.vendors
for each row
execute function audit.capture('vendor_id');

create trigger audit_vendor_accounts
after insert or update or delete on public.vendor_accounts
for each row
execute function audit.capture('account_id');

create trigger audit_properties
after insert or update or delete on public.properties
for each row
execute function audit.capture('property_id');

-- Only privilege changes: a role or active-status change.
create trigger audit_app_users
after update of role, status on public.app_users
for each row
execute function audit.capture('user_id');

-- 6. APPEND-ONLY

create or replace function audit.prevent_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'Audit records cannot be modified, deleted or truncated';
end;
$$;

revoke execute on function audit.prevent_changes()
from public, anon, authenticated, service_role;

-- Even the table's owner cannot edit or erase a row.
create trigger prevent_audit_mutation
before update or delete on audit.record_changes
for each row
execute function audit.prevent_changes();

-- Row-level triggers do not fire on TRUNCATE, so it gets its own. The same
-- guard closes the gap on public.audit_events, which already refuses row
-- updates and deletes (migration 20261027135848) but not TRUNCATE.
create trigger prevent_audit_truncate
before truncate on audit.record_changes
for each statement
execute function audit.prevent_changes();

create trigger prevent_audit_events_truncate
before truncate on public.audit_events
for each statement
execute function audit.prevent_changes();

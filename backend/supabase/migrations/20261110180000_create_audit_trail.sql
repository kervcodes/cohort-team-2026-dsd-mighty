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

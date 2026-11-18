-- Autopay (DC-86): an approved bill up to an admin-set limit gets a payment
-- run queued by the backend right after its approval, as if the approver had
-- pressed Pay with AI. A person still approves every bill; autopay only skips
-- the button. Off until an admin turns it on with a limit.

-- 1. SETTINGS

-- One global setting, so one row: the key can only be true, and the row is
-- seeded here. Nobody can insert another row or delete this one (section 3).
create table public.autopay_settings (
    id boolean primary key default true
        constraint autopay_settings_one_row check (id),

    enabled boolean not null default false,

    -- Bills up to this amount are paid automatically. Kept while autopay is
    -- off, so turning it back on needs no new limit.
    limit_amount numeric(12, 2)
        constraint autopay_settings_limit_positive
            check (limit_amount is null or limit_amount > 0),

    -- The admin who last changed the setting; null until someone does.
    updated_by uuid references public.app_users(user_id) on delete set null,
    updated_at timestamptz not null default now(),

    -- Autopay is never on without a limit.
    constraint autopay_settings_limit_when_enabled
        check (not enabled or limit_amount is not null)
);

insert into public.autopay_settings (id) values (true);

create trigger autopay_settings_set_updated_at
before update on public.autopay_settings
for each row
execute function public.set_updated_at();

-- Who turned autopay on or off, or moved the limit, and when.
create trigger audit_autopay_settings
after update on public.autopay_settings
for each row
execute function audit.capture('id');

-- 2. WHAT STARTED A RUN

-- 'manual': someone pressed Pay with AI. 'autopay': the backend queued the
-- run after an approval (started_by is then the approver).
alter table public.payment_runs
    add column trigger text not null default 'manual'
        constraint payment_runs_trigger_check
            check (trigger in ('manual', 'autopay'));

-- 3. ACCESS

-- Only the backend (service role) reads and changes the setting; browser
-- roles get nothing, even with row-level security off.
alter table public.autopay_settings enable row level security;

revoke all on table public.autopay_settings
from public, anon, authenticated, service_role;

grant select, update on table public.autopay_settings to service_role;

-- Payment runs (DC-84): "Pay with AI" on an approved bill queues a run, and
-- the payment agent worker claims it, pays the bill on the vendor's portal
-- and records the result.
--
-- Lifecycle:
--   queued   created by an approver or admin (POST /bills/{id}/payment-runs)
--   running  claimed by a worker (claim_next_payment_run)
--   paid     the portal took the payment and it is recorded (payment_id)
--   failed   the portal declined the payment; the failed attempt is
--            recorded (payment_id) and the bill stays approved
--   flagged  the agent stopped before or instead of paying, or could not
--            tell what happened; a person must look (flag_reason)

-- 1. TABLE

create table public.payment_runs (
    run_id uuid primary key default gen_random_uuid(),

    bill_id uuid not null references public.bills(bill_id),
    started_by uuid not null references public.app_users(user_id),

    status text not null default 'queued'
        check (status in ('queued', 'running', 'paid', 'flagged', 'failed')),

    -- What the agent did, oldest first: [{at, step, detail}, ...].
    -- Short, human-readable lines; never a password or payment details.
    steps jsonb not null default '[]'::jsonb
        check (jsonb_typeof(steps) = 'array'),

    flag_reason text,

    -- What the portal's receipt said: confirmation number, amount, paid on,
    -- portal. Set on a paid or failed run.
    receipt jsonb
        check (receipt is null or jsonb_typeof(receipt) = 'object'),

    payment_id uuid references public.payments(payment_id),

    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,
    updated_at timestamptz not null default now(),

    -- Every flagged run says why, and only flagged runs carry a reason.
    constraint payment_runs_flag_reason_only_when_flagged check (
        (status = 'flagged') = (flag_reason is not null)
    ),

    -- A worker stamps started_at when it claims the run, and finished_at
    -- when the run ends.
    constraint payment_runs_started_unless_queued check (
        (status = 'queued') = (started_at is null)
    ),
    constraint payment_runs_finished_when_done check (
        (status in ('paid', 'flagged', 'failed')) = (finished_at is not null)
    ),

    -- A paid or failed run points at the payment it recorded.
    constraint payment_runs_payment_when_recorded check (
        status not in ('paid', 'failed') or payment_id is not null
    )
);

-- At most one active run per bill: a second "Pay with AI" while one is
-- queued or running is refused (the API answers 409).
create unique index payment_runs_one_active_per_bill
    on public.payment_runs (bill_id)
    where status in ('queued', 'running');

-- GET /bills/{id}/payment-runs, newest first.
create index idx_payment_runs_bill_id
    on public.payment_runs (bill_id, created_at desc);

-- The worker's queue.
create index idx_payment_runs_queued
    on public.payment_runs (created_at)
    where status = 'queued';

create index idx_payment_runs_started_by
    on public.payment_runs (started_by);

create index idx_payment_runs_payment_id
    on public.payment_runs (payment_id);

create trigger payment_runs_set_updated_at
before update on public.payment_runs
for each row
execute function public.set_updated_at();

-- Only the backend (service role, which bypasses RLS) reads and writes runs.
alter table public.payment_runs enable row level security;

-- 2. CLAIM THE NEXT RUN (payment agent worker)

-- Takes the oldest queued run, marks it running and returns it; returns no
-- row when the queue is empty. `for update skip locked` lets several workers
-- claim at once without taking the same run or waiting on each other.
--
-- It first flags runs left running for more than 15 minutes (a worker that
-- crashed or was killed mid-run; a run's own time limit is far shorter).
-- They are flagged, never re-run: the portal may already have taken the
-- payment, so a person checks before anyone retries.
--
-- security definer and search_path: as in
-- 20261102050250_create_app_user_on_signup.

create function public.claim_next_payment_run()
returns setof public.payment_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_run_id uuid;
begin
    update public.payment_runs
    set status = 'flagged',
        flag_reason = 'The worker stopped before this run finished. '
            || 'Check the vendor portal before paying this bill again.',
        finished_at = now(),
        steps = steps || jsonb_build_array(jsonb_build_object(
            'at', now(),
            'step', 'flagged',
            'detail', 'Run was still running after 15 minutes; '
                || 'the worker probably stopped.'
        ))
    where status = 'running'
        and started_at < now() - interval '15 minutes';

    select run_id
    into v_run_id
    from public.payment_runs
    where status = 'queued'
    order by created_at, run_id
    limit 1
    for update skip locked;

    if not found then
        return;
    end if;

    return query
    update public.payment_runs
    set status = 'running',
        started_at = now(),
        steps = steps || jsonb_build_array(jsonb_build_object(
            'at', now(),
            'step', 'claimed',
            'detail', 'A payment worker picked up this run.'
        ))
    where run_id = v_run_id
    returning *;
end;
$$;

-- 3. ACCESS

revoke execute on function public.claim_next_payment_run()
from public, anon, authenticated;

grant execute on function public.claim_next_payment_run()
to service_role;

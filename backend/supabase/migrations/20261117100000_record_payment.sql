-- Record a payment against an approved bill (DC-54).

-- 0. GUARD

-- Section 1 adds recorded_by as not null and turns
-- payment_date into a date, which is only safe on an empty
-- table. Stop here, before any change, if it has rows.

do $$
begin
    if exists (select 1 from public.payments) then
        raise exception 'payments is not empty: backfill recorded_by before applying this migration';
    end if;
end;
$$;

-- 1. PAYMENT TABLE

-- The day a payment was made is a calendar date, not an
-- instant, and the API calls it paid_on. The guard above
-- leaves the table empty here.

alter table public.payments
    rename column payment_date to paid_on;

alter table public.payments
    alter column paid_on type date
    using (paid_on at time zone 'UTC')::date;

-- Who recorded the payment. The guard above leaves the
-- table empty, so not null is safe.

alter table public.payments
    add column recorded_by uuid not null
        references public.app_users(user_id);

create index idx_payments_recorded_by
    on public.payments(recorded_by);

-- A failure reason belongs to a failed payment, and every
-- failed payment has one.

alter table public.payments
    add constraint payments_failure_reason_only_when_failed check (
        (payment_status = 'failed') = (failure_reason is not null)
    );

-- A bill is paid at most once, whatever writes the row.

create unique index payments_one_completed_per_bill
    on public.payments (bill_id)
    where payment_status = 'completed';

-- 2. RECORD PAYMENT FUNCTION

-- Records one payment attempt for an approved bill. A
-- completed payment must be for the bill amount and moves
-- the bill to paid in the same transaction; a failed one
-- leaves the bill approved.
--
-- Refusals use custom SQLSTATEs that the backend maps to
-- HTTP statuses (PostgREST also answers PTxxx with HTTP
-- xxx):
--   PT404  the bill does not exist
--   PT409  the bill is not approved; DETAIL is its status
--   PT422  a completed payment is not for the bill amount;
--          DETAIL is the bill amount
--
-- The checks compare with is distinct from, so a null bill
-- status or amount is refused rather than read as a match,
-- whatever constraints the bills table has. RAISE refuses a
-- null option, so DETAIL is empty when the value is null.
--
-- security definer and search_path: as in
-- 20261102050250_create_app_user_on_signup.

create function public.record_payment(
    p_bill_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_paid_on date,
    p_provider_reference text,
    p_payment_status text,
    p_failure_reason text,
    p_recorded_by uuid
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_bill record;
    v_payment public.payments;
begin
    if p_payment_status is null
        or p_payment_status not in ('completed', 'failed') then
        raise exception 'payment_status must be completed or failed, not %',
            p_payment_status
            using errcode = '22023';
    end if;

    -- The row lock makes concurrent calls for one bill run
    -- one after another, so the second sees the first's
    -- result: one payment, and a PT409 for the other.
    select status, amount
    into v_bill
    from public.bills
    where bill_id = p_bill_id
    for update;

    if not found then
        raise exception 'Bill % not found', p_bill_id
            using errcode = 'PT404';
    end if;

    if v_bill.status is distinct from 'approved' then
        raise exception 'Bill % is %, not approved', p_bill_id, v_bill.status
            using errcode = 'PT409',
                detail = coalesce(v_bill.status, '');
    end if;

    if p_payment_status = 'completed'
        and p_amount is distinct from v_bill.amount then
        raise exception 'Payment amount % does not match bill amount %',
            p_amount, v_bill.amount
            using errcode = 'PT422',
                detail = coalesce(v_bill.amount::text, '');
    end if;

    insert into public.payments (
        bill_id,
        payment_method,
        amount,
        paid_on,
        attempt_number,
        payment_status,
        provider_reference,
        failure_reason,
        recorded_by
    )
    values (
        p_bill_id,
        p_payment_method,
        p_amount,
        p_paid_on,
        (
            select coalesce(max(attempt_number), 0) + 1
            from public.payments
            where bill_id = p_bill_id
        ),
        p_payment_status,
        p_provider_reference,
        p_failure_reason,
        p_recorded_by
    )
    returning * into v_payment;

    if p_payment_status = 'completed' then
        update public.bills
        set status = 'paid'
        where bill_id = p_bill_id;
    end if;

    return v_payment;
end;
$$;

-- Only the backend (service role) records payments.
revoke execute on function public.record_payment(
    uuid, numeric, text, date, text, text, text, uuid
)
from public, anon, authenticated;

grant execute on function public.record_payment(
    uuid, numeric, text, date, text, text, text, uuid
)
to service_role;

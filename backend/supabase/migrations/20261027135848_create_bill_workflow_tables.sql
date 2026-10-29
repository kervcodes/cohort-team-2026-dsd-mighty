-- 1. BILLS

create table public.bills (
    bill_id uuid primary key default gen_random_uuid(),

    -- Optional relationships: support unmatched bills
    property_id uuid references public.properties(property_id),
    vendor_id uuid references public.vendors(vendor_id),
    vendor_account_id uuid references public.vendor_accounts(account_id),
    property_address text not null,
    account_status text not null,
    website_name text not null,

    -- Required submitter
    submitted_by uuid not null references public.app_users(user_id),

    -- Invoice information
    invoice_number text not null,
    invoice_date date not null,
    due_date date not null,
    amount numeric(12,2) not null check (amount > 0),

    -- Original information from the submitted bill
    account_number_raw text not null,
    vendor_name_raw text,
    prev_payments numeric(12,2)
        check (prev_payments >= 0),

    -- Additional bill information
    description text,
    processing_notes text,
    document_path text,
    exception_reason text,

    -- Bill lifecycle
    status text not null default 'draft'
        check (
            status in (
                'draft',
                'pending_approval',
                'approved',
                'rejected',
                'paid',
                'failed',
                'exception'
            )
        ),

    -- Timestamps
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- 2. APPROVALS

create table public.approvals (
    approval_id uuid primary key default gen_random_uuid(),

    bill_id uuid not null references public.bills(bill_id),
    reviewer_id uuid references public.app_users(user_id),

    requested_at timestamptz not null default now(),
    decision_at timestamptz,

    comments text,

    approval_status text not null default 'pending'
        check (
            approval_status in (
                'pending',
                'approved',
                'rejected'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Completed decisions must have a reviewer and decision time
    constraint completed_approval_needs_reviewer check (
        (
            approval_status = 'pending'
            and decision_at is null
        )
        or
        (
            approval_status in ('approved', 'rejected')
            and reviewer_id is not null
            and decision_at is not null
        )
    )
);


-- 3. AUDIT EVENTS

create table public.audit_events (
    event_id uuid primary key default gen_random_uuid(),

    bill_id uuid not null references public.bills(bill_id),
    user_id uuid references public.app_users(user_id),

    action text not null,
    old_status text,
    new_status text,
    details text,

    -- Audit records are historical events
    occurred_at timestamptz not null default now()
);


-- 4. PAYMENTS

create table public.payments (
    payment_id uuid primary key default gen_random_uuid(),

    bill_id uuid not null references public.bills(bill_id),

    payment_method text not null
        check (
            payment_method in (
                'check',
                'ach',
                'wire',
                'credit_card',
                'other'
            )
        ),

    amount numeric(12,2) not null check (amount > 0),

    payment_date timestamptz,

    attempt_number integer not null
        check (attempt_number >= 1),

    payment_status text not null default 'pending'
        check (
            payment_status in (
                'pending',
                'completed',
                'failed'
            )
        ),

    gateway_status text,
    provider_reference text,
    failure_reason text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Prevent duplicate attempt numbers for the same bill
    unique (bill_id, attempt_number)
);


-- 5. ROW LEVEL SECURITY

-- RLS remains enabled.
-- Authorization policies or server-side authorization
-- must be implemented before the application uses these tables.

alter table public.bills enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_events enable row level security;
alter table public.payments enable row level security;


-- 6. DUPLICATE INVOICE PROTECTION

create unique index bills_account_invoice_unique
on public.bills (
    vendor_account_id,
    lower(btrim(invoice_number))
)
where vendor_account_id is not null;


-- 7. AUDIT EVENT PROTECTION

-- Audit events should not be updated or deleted.
-- Corrections must be recorded as new events.

create function public.prevent_audit_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'Audit events cannot be modified or deleted';
end;
$$;

create trigger prevent_audit_mutation
before update or delete on public.audit_events
for each row
execute function public.prevent_audit_changes();


-- 8. UPDATED_AT TRIGGERS

-- Reuse the set_updated_at() function created
-- in the previous migration.

create trigger bills_set_updated_at
before update on public.bills
for each row
execute function public.set_updated_at();

create trigger approvals_set_updated_at
before update on public.approvals
for each row
execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();


-- 9. FOREIGN KEY INDEXES

-- Vendor account indexes
-- The existing composite UNIQUE constraint already indexes
-- property_id as its leading column.

create index idx_vendor_accounts_vendor_id
    on public.vendor_accounts(vendor_id);


-- Bill indexes
create index idx_bills_property_id
    on public.bills(property_id);

create index idx_bills_vendor_id
    on public.bills(vendor_id);

create index idx_bills_submitted_by
    on public.bills(submitted_by);


-- Approval indexes
create index idx_approvals_bill_id
    on public.approvals(bill_id);

create index idx_approvals_reviewer_id
    on public.approvals(reviewer_id);


-- Audit event indexes
create index idx_audit_events_bill_id
    on public.audit_events(bill_id);

create index idx_audit_events_user_id
    on public.audit_events(user_id);


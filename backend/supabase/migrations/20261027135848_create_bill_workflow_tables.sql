create table public.bills (
    bill_id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(property_id),
    bill_description text,
    processing_notes text,
    vendor_id uuid references public.vendors(vendor_id),
    vendor_account_id uuid references public.vendor_accounts(account_id),
    submitted_by uuid not null references public.app_users(user_id),
    invoice_number text not null,
    invoice_date date not null,
    due_date date,
    amount numeric(12,2) not null check (amount > 0),
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    document_path text,
    exception_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.approvals (
    approval_id uuid primary key default gen_random_uuid(),
    bill_id uuid not null references public.bills(bill_id),
    reviewer_id uuid references public.app_users(user_id),
    requested_at timestamptz not null default now(),
    decision_at timestamptz,
    comments text,
    approval_status text not null default 'pending'
        check (approval_status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint completed_approval_needs_reviewer check (
        (approval_status = 'pending' and decision_at is null)
        or
        (approval_status in ('approved', 'rejected')
         and reviewer_id is not null
         and decision_at is not null)
    )
);

create table public.audit_events (
    event_id uuid primary key default gen_random_uuid(),
    bill_id uuid not null references public.bills(bill_id),
    user_id uuid references public.app_users(user_id),
    action text not null,
    old_status text,
    new_status text,
    details text,
    occurred_at timestamptz not null default now()
);

create table public.payments (
    payment_id uuid primary key default gen_random_uuid(),
    bill_id uuid not null references public.bills(bill_id),
    payment_method text not null,
    amount numeric(12,2) not null check (amount > 0),
    payment_date timestamptz,
    attempt_number integer not null check (attempt_number >= 1),
    payment_status text not null default 'initiated',
    gateway_status text,
    provider_reference text,
    failure_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (bill_id, attempt_number)
);

alter table public.bills enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_events enable row level security;
alter table public.payments enable row level security;

-- Attach the shared timestamp function created in Migration A.
create trigger bills_set_updated_at
before update on public.bills
for each row execute function public.set_updated_at();

create trigger approvals_set_updated_at
before update on public.approvals
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create index idx_vendor_accounts_property_id
    on public.vendor_accounts(property_id);
create index idx_vendor_accounts_vendor_id
    on public.vendor_accounts(vendor_id);
create index idx_bills_property_id
    on public.bills(property_id);
create index idx_bills_vendor_id
    on public.bills(vendor_id);
create index idx_bills_vendor_account_id
    on public.bills(vendor_account_id);
create index idx_bills_submitted_by
    on public.bills(submitted_by);
create index idx_approvals_bill_id
    on public.approvals(bill_id);
create index idx_approvals_reviewer_id
    on public.approvals(reviewer_id);
create index idx_audit_events_bill_id
    on public.audit_events(bill_id);
create index idx_audit_events_user_id
    on public.audit_events(user_id);
create index idx_payments_bill_id
    on public.payments(bill_id);

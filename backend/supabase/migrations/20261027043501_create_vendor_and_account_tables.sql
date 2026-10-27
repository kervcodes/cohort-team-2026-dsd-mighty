create table public.vendors (
    vendor_id uuid primary key default gen_random_uuid(),
    vendor_name text not null,
    contact_email text,
    contact_phone text,
    default_payment_method text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.app_users (
    user_id uuid primary key default gen_random_uuid(),
    full_name text null,
    email text not null unique,
    role text not null,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.vendor_accounts (
    account_id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(property_id),
    vendor_id uuid not null references public.vendors(vendor_id),
    account_number text not null,
    account_type text,
    payment_method text,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (property_id, vendor_id, account_number)
);

alter table public.vendors enable row level security;
alter table public.app_users enable row level security;
alter table public.vendor_accounts enable row level security;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

create trigger vendors_set_updated_at
before update on public.vendors
for each row execute function public.set_updated_at();

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create trigger vendor_accounts_set_updated_at
before update on public.vendor_accounts
for each row execute function public.set_updated_at();



-- 1. VENDORS

create table public.vendors (
    vendor_id uuid primary key default gen_random_uuid(),

    vendor_name text not null,
    contact_email text,
    contact_phone text,

    -- Optional default payment method
    default_payment_method text
        check (
            default_payment_method in (
                'check',
                'ach',
                'wire',
                'credit_card',
                'other'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. APPLICATION USERS

create table public.app_users (
    -- Use the user's existing Supabase Auth ID.
    user_id uuid primary key
        references auth.users(id),

    full_name text not null,
    email text not null,

    -- Allowed application roles
    role text not null default 'analyst'
        check (
            role in (
                'analyst',
                'approver',
                'admin'
            )
        ),

    -- Allowed user account statuses
    status text not null default 'active'
        check (
            status in (
                'active',
                'inactive'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 3. VENDOR ACCOUNTS

create table public.vendor_accounts (
    account_id uuid primary key default gen_random_uuid(),

    -- Each vendor account belongs to a property and vendor.
    property_id uuid not null
        references public.properties(property_id),

    vendor_id uuid not null
        references public.vendors(vendor_id),

    account_number text not null,
    account_type text not null,

    -- Required payment method
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

    -- Optional vendor payment portal
    portal_url text,

    status text not null default 'active'
        check (
            status in (
                'active',
                'inactive'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Prevent duplicate account numbers for the same
    -- property and vendor.
    constraint vendor_accounts_property_vendor_number_unique
        unique (
            property_id,
            vendor_id,
            account_number
        )
);


-- 4. ROW LEVEL SECURITY

-- Keep RLS enabled.
-- Application access still requires an agreed
-- authorization strategy.

alter table public.vendors enable row level security;
alter table public.app_users enable row level security;
alter table public.vendor_accounts enable row level security;

-- 5. CASE-INSENSITIVE EMAIL UNIQUENESS

-- Prevent duplicate emails that differ only by case.

create unique index app_users_email_ci_unique
on public.app_users (lower(email));


-- 6. UPDATED_AT TRIGGER FUNCTION

-- Automatically update updated_at when a record changes.

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

-- 7. UPDATED_AT TRIGGERS

create trigger properties_set_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

-- Vendors
create trigger vendors_set_updated_at
before update on public.vendors
for each row
execute function public.set_updated_at();

-- Application users
create trigger app_users_set_updated_at
before update on public.app_users
for each row
execute function public.set_updated_at();

-- Vendor accounts
create trigger vendor_accounts_set_updated_at
before update on public.vendor_accounts
for each row
execute function public.set_updated_at();

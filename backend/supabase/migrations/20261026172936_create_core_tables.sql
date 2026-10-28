-- 1. PROPERTIES

create table public.properties (
    property_id uuid primary key default gen_random_uuid(),

    -- Property information
    property_name text not null,

    -- Address information
    street text not null,
    city text not null,
    state text not null
        check (state ~ '^[A-Za-z]{2}$'),

    zip_code text not null
        check (zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),

    -- Property status
    status text not null default 'active'
        check (
            status in (
                'active',
                'inactive'
            )
        ),

    -- Timestamps
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. ROW LEVEL SECURITY

-- Enable RLS for the properties table.
-- Authorization policies or secure server-side access
-- must be implemented before using this table.

alter table public.properties enable row level security;


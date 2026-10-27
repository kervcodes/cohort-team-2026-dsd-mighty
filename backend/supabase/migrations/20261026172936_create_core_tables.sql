create table public.properties (
    property_id uuid primary key DEFAULT gen_random_uuid(),
    property_name text not null,
    street text not null,
    city text not null,
    state text not null,
    zip_code text null,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.properties enable row level security;

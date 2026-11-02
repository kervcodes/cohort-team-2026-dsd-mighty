alter table public.bills
    add column property_address text not null,
    add column account_status text not null,
    add column website_name text not null;

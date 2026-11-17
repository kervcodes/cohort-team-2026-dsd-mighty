-- The demo seed (seed.sql, DC-37) is loaded and can be applied again.
-- Runs in one transaction that rolls back.

begin;

select plan(6);

-- 1. SEEDED ROWS UNDER THEIR FIXED IDS

select is(
    (select count(*)::int from public.properties
     where property_id = '10000000-0000-4000-8000-000000000001'),
    1,
    'the demo property is seeded'
);

select is(
    (select count(*)::int from public.vendors
     where vendor_id::text like '20000000-0000-4000-8000-00000000000_'),
    10,
    'the 10 demo vendors are seeded'
);

select is(
    (select count(*)::int from public.vendor_accounts
     where account_id::text like '30000000-0000-4000-8000-00200045670_'
       and property_id = '10000000-0000-4000-8000-000000000001'
       and vendor_id::text like '20000000-0000-4000-8000-00000000000_'),
    10,
    'the 10 demo vendor accounts are seeded on the demo property'
);

-- 2. APPLYING THE SEED AGAIN ADDS NOTHING

create temp table seeded_counts as
select
    (select count(*) from public.properties) as properties,
    (select count(*) from public.vendors) as vendors,
    (select count(*) from public.vendor_accounts) as vendor_accounts;

-- The inserts of seed.sql, as written there.

insert into public.properties
    (property_id, property_name, street, city, state, zip_code, status)
values
    ('10000000-0000-4000-8000-000000000001', '125 Industrial Way', '125 Industrial Way', 'Springfield', 'IL', '62701', 'active')
on conflict do nothing;

insert into public.vendors
    (vendor_id, vendor_name)
values
    ('20000000-0000-4000-8000-000000000000', 'Alder Creek Landscaping'),
    ('20000000-0000-4000-8000-000000000001', 'Brightwater Water & Sewer'),
    ('20000000-0000-4000-8000-000000000002', 'Copper Ridge Waste Services'),
    ('20000000-0000-4000-8000-000000000003', 'Northline'),
    ('20000000-0000-4000-8000-000000000004', 'Sunmeadow Cleaning'),
    ('20000000-0000-4000-8000-000000000005', 'Cedar Valley Pest Control'),
    ('20000000-0000-4000-8000-000000000006', 'Harborlight Security'),
    ('20000000-0000-4000-8000-000000000007', 'Prairie Grid HVAC Services'),
    ('20000000-0000-4000-8000-000000000008', 'Maple Junction Storage'),
    ('20000000-0000-4000-8000-000000000009', 'Summit Trail Equipment Rental')
on conflict do nothing;

insert into public.vendor_accounts
    (account_id, property_id, vendor_id, account_number, account_type, payment_method, portal_url, status)
values
    ('30000000-0000-4000-8000-002000456700', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000000', '2000456700', 'landscaping', 'ach', 'https://alder-creek-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456701', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2000456701', 'water_sewer', 'ach', 'https://brightwater-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456702', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '2000456702', 'waste', 'ach', 'https://copper-ridge-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456703', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '2000456703', 'internet', 'ach', 'https://northline-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456704', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '2000456704', 'cleaning', 'ach', 'https://sunmeadow-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456705', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', '2000456705', 'pest_control', 'ach', 'https://cedar-valley-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456706', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', '2000456706', 'security', 'ach', 'https://harborlight-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456707', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000007', '2000456707', 'hvac', 'ach', 'https://prairie-grid-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456708', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000008', '2000456708', 'storage', 'ach', 'https://maple-junction-utility-demo.vercel.app', 'active'),
    ('30000000-0000-4000-8000-002000456709', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000009', '2000456709', 'equipment_rental', 'ach', 'https://summit-trail-utility-demo.vercel.app', 'active')
on conflict do nothing;


select is(
    (select count(*) from public.properties),
    (select properties from seeded_counts),
    'applying the seed again adds no property'
);

select is(
    (select count(*) from public.vendors),
    (select vendors from seeded_counts),
    'applying the seed again adds no vendor'
);

select is(
    (select count(*) from public.vendor_accounts),
    (select vendor_accounts from seeded_counts),
    'applying the seed again adds no vendor account'
);

select * from finish();

rollback;

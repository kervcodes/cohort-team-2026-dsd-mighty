-- Seed data for local development and the demo (DC-37).
--
-- Source: the 10 DSD demo bills. Their expected extraction results are in
-- backend/evals/bills/expected/*-bill.json, and every value below is copied
-- from them: vendor_name, account_number, service_address (split into
-- street, city, state and zip_code) and payment_website (portal_url).
-- backend/tests/test_seed.py fails if this file drifts from those files.
--
-- All 10 bills share one service address, so there is one property.
-- account_type is derived from each bill's description. payment_method is
-- 'ach': the demo portals take a one-time ACH payment (their default) or a
-- card, and ACH is how a business normally pays recurring vendor bills.
--
-- Ids are fixed so tests and later tickets can refer to them:
--   property        10000000-0000-4000-8000-000000000001
--   vendor          20000000-0000-4000-8000-0000000000NN, NN = last two
--                   digits of its account number
--   vendor account  30000000-0000-4000-8000-00<account number>
--
-- Every insert is `on conflict do nothing`, so the file can be applied again
-- to an existing local database. No users, passwords or portal logins are
-- seeded: admins enter portal logins in the app.

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

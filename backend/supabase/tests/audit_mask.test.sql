-- audit.mask() hides bank, account and tax identifiers in a row before it is
-- logged (migration 20261110180000_create_audit_trail, section 3).
-- Runs in one transaction that rolls back.

begin;

select plan(9);

select is(audit.mask(null), null, 'masking a missing row gives a missing row');

select is(audit.mask('{}'), '{}'::jsonb, 'masking an empty row gives an empty row');

select is(
    audit.mask('{"account_number": "11112222"}'),
    '{"account_number": "****2222"}'::jsonb,
    'an account number keeps its last four characters'
);

select is(
    audit.mask('{"account_number_raw": "555"}'),
    '{"account_number_raw": "****"}'::jsonb,
    'an identifier of four characters or fewer is masked completely'
);

select is(
    audit.mask('{"account_number_raw": "12345"}'),
    '{"account_number_raw": "****2345"}'::jsonb,
    'five characters keep four'
);

select is(
    audit.mask('{"tax_id": "123-45-6789", "name": "x", "ein": 7}'),
    '{"tax_id": "****6789", "name": "x", "ein": 7}'::jsonb,
    'tax ids are masked by name; other columns and non-text values are kept'
);

select is(
    audit.mask(
        '{"bank_account_number": "9876543210", "routing_number": "021000021", "ssn": "123-45-6789"}'
    ),
    '{"bank_account_number": "****3210", "routing_number": "****0021", "ssn": "****6789"}'::jsonb,
    'bank account, routing and social security numbers are masked'
);

select is(
    audit.mask('{"account_number": null}'),
    '{"account_number": null}'::jsonb,
    'a missing identifier stays missing'
);

select is(
    (select count(*)::int
     from unnest(array['anon', 'authenticated', 'service_role']) as r(role_name)
     where has_function_privilege(r.role_name, 'audit.mask(jsonb)', 'execute')),
    0,
    'no API role can call audit.mask()'
);

select * from finish();

rollback;

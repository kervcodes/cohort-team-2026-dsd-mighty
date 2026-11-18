-- audit.mask also masks portal_password_secret_id, the Vault secret id of a
-- vendor account's portal password (20261115100000_vendor_portal_login), so
-- the audit log and the admin audit API never carry it in full, as
-- VendorAccountRead never does. The function is otherwise unchanged.

create or replace function audit.mask(row_data jsonb)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
    select coalesce(
        jsonb_object_agg(
            e.key,
            case
                when e.key in (
                    'account_number',
                    'account_number_raw',
                    'bank_account_number',
                    'routing_number',
                    'tax_id',
                    'ein',
                    'ssn',
                    'portal_password_secret_id'
                )
                and jsonb_typeof(e.value) = 'string'
                then to_jsonb(
                    '****' || case
                        when length(e.value #>> '{}') > 4
                        then right(e.value #>> '{}', 4)
                        else ''
                    end
                )
                else e.value
            end
        ),
        '{}'::jsonb
    )
    from jsonb_each(row_data) as e;
$$;

revoke execute on function audit.mask(jsonb)
from public, anon, authenticated, service_role;

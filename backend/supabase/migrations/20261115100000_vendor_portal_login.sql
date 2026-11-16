-- Portal login for vendor accounts: the payment agent signs in to the
-- vendor's payment portal with it.
--
-- The email is a plain column. The password lives in Supabase Vault
-- (encrypted at rest); the account row keeps only the Vault secret id. Only
-- the functions below touch the secret. The backend (service role) creates
-- and updates an account through one function call each, so the account's
-- columns and its password change in one transaction or not at all.

-- 1. COLUMNS

alter table public.vendor_accounts
    add column portal_login_email text,

    -- One secret per account. If the secret is deleted from Vault directly,
    -- the account reads as "no password set" instead of pointing at nothing.
    add column portal_password_secret_id uuid
        unique
        references vault.secrets(id) on delete set null;

-- 2. SET OR REPLACE THE PASSWORD

-- A building block for sections 4 and 5; nobody calls it directly.
--
-- security definer: the function runs as its owner, who may write Vault;
-- the service role gets no direct Vault write access through it.
-- search_path = '': security definer functions must not resolve names
-- through a caller-controlled search path.

create function public.set_vendor_account_portal_password(
    p_account_id uuid,
    p_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_secret_id uuid;
begin
    if p_password is null or p_password = '' then
        raise exception 'portal password must not be empty'
            using errcode = '22023';
    end if;

    -- Lock the row so two writers cannot both create a secret for it.
    select portal_password_secret_id
    into v_secret_id
    from public.vendor_accounts
    where account_id = p_account_id
    for update;

    if not found then
        raise exception 'vendor account % not found', p_account_id
            using errcode = 'P0002';
    end if;

    if v_secret_id is null then
        v_secret_id := vault.create_secret(
            p_password,
            'vendor_account_portal_password:' || p_account_id::text,
            'Portal password for vendor account ' || p_account_id::text
        );

        update public.vendor_accounts
        set portal_password_secret_id = v_secret_id
        where account_id = p_account_id;
    else
        perform vault.update_secret(v_secret_id, p_password);
    end if;
end;
$$;

-- 3. CLEAR THE PASSWORD

-- A building block for section 5; nobody calls it directly.

create function public.clear_vendor_account_portal_password(
    p_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_secret_id uuid;
begin
    select portal_password_secret_id
    into v_secret_id
    from public.vendor_accounts
    where account_id = p_account_id
    for update;

    if not found then
        raise exception 'vendor account % not found', p_account_id
            using errcode = 'P0002';
    end if;

    if v_secret_id is not null then
        -- The foreign key's on delete set null clears the account's id.
        delete from vault.secrets where id = v_secret_id;
    end if;
end;
$$;

-- 4. CREATE AN ACCOUNT WITH ITS PASSWORD

-- p_account is a JSON object of column values: property_id, vendor_id,
-- account_number, account_type, payment_method, portal_url,
-- portal_login_email and status. A missing key reads as null. Any other key
-- (portal_password included) is refused with 22023, so a field is never
-- silently dropped and the password never travels in p_account.
--
-- p_password: null stores no password, a value stores it in Vault.
--
-- One transaction: if storing the password fails, the account is not
-- created. A duplicate account number raises 23505, an unknown property or
-- vendor 23503. Returns the new row.

create function public.create_vendor_account(
    p_account jsonb,
    p_password text
)
returns setof public.vendor_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_account_id uuid;
    v_unknown text;
begin
    if p_account is null or jsonb_typeof(p_account) <> 'object' then
        raise exception 'vendor account must be a JSON object'
            using errcode = '22023';
    end if;

    select string_agg(field, ', ' order by field)
    into v_unknown
    from jsonb_object_keys(p_account) as field
    where field not in (
        'property_id', 'vendor_id', 'account_number', 'account_type',
        'payment_method', 'portal_url', 'portal_login_email', 'status'
    );

    if v_unknown is not null then
        raise exception 'unknown vendor account fields: %', v_unknown
            using errcode = '22023';
    end if;

    insert into public.vendor_accounts (
        property_id,
        vendor_id,
        account_number,
        account_type,
        payment_method,
        portal_url,
        portal_login_email,
        status
    )
    values (
        (p_account ->> 'property_id')::uuid,
        (p_account ->> 'vendor_id')::uuid,
        p_account ->> 'account_number',
        p_account ->> 'account_type',
        p_account ->> 'payment_method',
        p_account ->> 'portal_url',
        p_account ->> 'portal_login_email',
        p_account ->> 'status'
    )
    returning account_id into v_account_id;

    if p_password is not null then
        perform public.set_vendor_account_portal_password(
            v_account_id, p_password
        );
    end if;

    return query
    select * from public.vendor_accounts where account_id = v_account_id;
end;
$$;

-- 5. UPDATE AN ACCOUNT AND ITS PASSWORD

-- p_changes is a JSON object holding only the columns to change; a key
-- that is absent leaves its column as it is, and a JSON null sets it to
-- null. Allowed keys: account_number, account_type, payment_method,
-- portal_url, portal_login_email, status. Any other key is refused with
-- 22023.
--
-- p_password_action says what happens to the password, so "not sent" and
-- "clear it" stay distinct:
--   'keep'  leave it as it is (p_password must be null)
--   'clear' delete it from Vault (p_password must be null)
--   'set'   store p_password, creating or replacing the secret
--
-- One transaction: the column changes are made first, then the password
-- change; if the password change fails (an empty password raises 22023),
-- the column changes are undone too. A taken account number raises 23505.
-- Returns the updated row, or no row when the account does not exist.

create function public.update_vendor_account(
    p_account_id uuid,
    p_changes jsonb,
    p_password_action text,
    p_password text
)
returns setof public.vendor_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_unknown text;
begin
    if p_password_action is null
        or p_password_action not in ('keep', 'clear', 'set') then
        raise exception 'portal password action must be keep, clear or set'
            using errcode = '22023';
    end if;

    if p_password_action <> 'set' and p_password is not null then
        raise exception 'a portal password goes only with the set action'
            using errcode = '22023';
    end if;

    if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
        raise exception 'vendor account changes must be a JSON object'
            using errcode = '22023';
    end if;

    select string_agg(field, ', ' order by field)
    into v_unknown
    from jsonb_object_keys(p_changes) as field
    where field not in (
        'account_number', 'account_type', 'payment_method', 'portal_url',
        'portal_login_email', 'status'
    );

    if v_unknown is not null then
        raise exception 'unknown vendor account fields: %', v_unknown
            using errcode = '22023';
    end if;

    -- Lock the row for the whole call.
    perform 1
    from public.vendor_accounts
    where account_id = p_account_id
    for update;

    if not found then
        return;
    end if;

    -- No columns sent: leave the row (and its updated_at) untouched.
    if p_changes <> '{}'::jsonb then
        update public.vendor_accounts
        set
            account_number = case when p_changes ? 'account_number'
                then p_changes ->> 'account_number' else account_number end,
            account_type = case when p_changes ? 'account_type'
                then p_changes ->> 'account_type' else account_type end,
            payment_method = case when p_changes ? 'payment_method'
                then p_changes ->> 'payment_method' else payment_method end,
            portal_url = case when p_changes ? 'portal_url'
                then p_changes ->> 'portal_url' else portal_url end,
            portal_login_email = case when p_changes ? 'portal_login_email'
                then p_changes ->> 'portal_login_email'
                else portal_login_email end,
            status = case when p_changes ? 'status'
                then p_changes ->> 'status' else status end
        where account_id = p_account_id;
    end if;

    if p_password_action = 'set' then
        perform public.set_vendor_account_portal_password(
            p_account_id, p_password
        );
    elsif p_password_action = 'clear' then
        perform public.clear_vendor_account_portal_password(p_account_id);
    end if;

    return query
    select * from public.vendor_accounts where account_id = p_account_id;
end;
$$;

-- 6. READ THE LOGIN (payment agent only)

-- No row when the account does not exist; portal_password is null when none
-- is set.

create function public.get_vendor_account_portal_login(
    p_account_id uuid
)
returns table (
    portal_url text,
    portal_login_email text,
    portal_password text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        a.portal_url,
        a.portal_login_email,
        s.decrypted_secret
    from public.vendor_accounts as a
    left join vault.decrypted_secrets as s
        on s.id = a.portal_password_secret_id
    where a.account_id = p_account_id;
$$;

-- 7. DELETE THE SECRET WITH ITS ACCOUNT

-- A deleted account must not leave its password behind in Vault.

create function public.delete_vendor_account_portal_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.portal_password_secret_id is not null then
        delete from vault.secrets where id = old.portal_password_secret_id;
    end if;

    return old;
end;
$$;

create trigger vendor_accounts_delete_portal_password
after delete on public.vendor_accounts
for each row
execute function public.delete_vendor_account_portal_password();

-- 8. ACCESS

-- Functions are executable by public by default, and Supabase's default
-- privileges also grant anon, authenticated and service_role. Only the
-- backend (service role) may call the create, update and read functions.
-- Nobody calls the set and clear building blocks or the trigger function
-- directly: the functions above run as the owner, who may always call them,
-- and a separate set or clear call could not share the column change's
-- transaction.

revoke execute on function public.create_vendor_account(jsonb, text)
from public, anon, authenticated;

revoke execute on function public.update_vendor_account(uuid, jsonb, text, text)
from public, anon, authenticated;

revoke execute on function public.get_vendor_account_portal_login(uuid)
from public, anon, authenticated;

revoke execute on function public.set_vendor_account_portal_password(uuid, text)
from public, anon, authenticated, service_role;

revoke execute on function public.clear_vendor_account_portal_password(uuid)
from public, anon, authenticated, service_role;

revoke execute on function public.delete_vendor_account_portal_password()
from public, anon, authenticated, service_role;

grant execute on function public.create_vendor_account(jsonb, text)
to service_role;

grant execute on function public.update_vendor_account(uuid, jsonb, text, text)
to service_role;

grant execute on function public.get_vendor_account_portal_login(uuid)
to service_role;

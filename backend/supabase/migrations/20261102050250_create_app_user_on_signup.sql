-- 1. APP USER FULL NAME FUNCTION

-- One rule for the signup trigger and the backfill:
-- the metadata full_name, trimmed, or else the email
-- local part.

create or replace function public.app_user_full_name(
    email text,
    metadata jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
    select coalesce(
        nullif(btrim(metadata->>'full_name'), ''),
        split_part(email, '@', 1)
    );
$$;

-- Only its owner calls it, through the security definer
-- trigger functions below.
revoke execute on function public.app_user_full_name(text, jsonb)
from public, anon, authenticated;

-- 2. APP USER ON SIGNUP FUNCTION

-- Create the matching app_users row when Supabase Auth
-- creates a user.
-- security definer: the trigger runs as the auth service
-- role, which cannot write to public.app_users.
-- search_path = '': security definer functions must not
-- resolve names through a caller-controlled search path.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Never read role or status from user metadata: it is
    -- set by the user at signup, so anyone could claim
    -- admin. Self-signup is public, so new users start
    -- inactive until an admin activates them. Role takes
    -- its default.
    insert into public.app_users (user_id, full_name, email, status)
    values (
        new.id,
        public.app_user_full_name(new.email, new.raw_user_meta_data),
        new.email,
        'inactive'
    )
    on conflict (user_id) do nothing;

    return new;
end;
$$;

-- Only the trigger calls this function.
revoke execute on function public.handle_new_auth_user()
from public, anon, authenticated;

-- 3. APP USER ON SIGNUP TRIGGER

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

-- 4. APP USER EMAIL SYNC

-- Keep app_users.email equal to the auth email. A stale
-- email would also block a new signup that reuses it,
-- through app_users_email_ci_unique.
-- security definer and search_path: as in section 2.

create or replace function public.handle_auth_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.app_users
    set email = new.email
    where user_id = new.id;

    return new;
end;
$$;

-- Only the trigger calls this function.
revoke execute on function public.handle_auth_user_email_updated()
from public, anon, authenticated;

drop trigger if exists on_auth_user_email_updated on auth.users;

create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.handle_auth_user_email_updated();

-- 5. CASCADE AUTH USER DELETES

-- Deleting an auth user removes its app_users row. Bills,
-- approvals and audit events still reference app_users
-- with no action, so a user with history cannot be
-- deleted.

alter table public.app_users
    drop constraint if exists app_users_user_id_fkey,
    add constraint app_users_user_id_fkey
        foreign key (user_id)
        references auth.users(id)
        on delete cascade;

-- 6. BACKFILL EXISTING AUTH USERS

-- Same rules as the signup trigger, for users who signed
-- up before it existed. Existing app_users rows are kept.

insert into public.app_users (user_id, full_name, email, status)
select
    u.id,
    public.app_user_full_name(u.email, u.raw_user_meta_data),
    u.email,
    'inactive'
from auth.users as u
where not exists (
    select 1
    from public.app_users as a
    where a.user_id = u.id
)
on conflict (user_id) do nothing;

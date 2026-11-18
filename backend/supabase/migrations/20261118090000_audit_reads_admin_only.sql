-- Only admins read the audit log (DC-88). Migration 20261110180100 also let an
-- active analyst or approver read the rows of bills they may read; the team
-- agreed the log is for admins alone. audit.can_read keeps its signature,
-- security definer, search_path and grants, so the record_changes_select
-- policy that calls it needs no change. The row arguments are no longer used.
-- security definer: app_users has row-level security and no policy for the caller.
create or replace function audit.can_read(row_bill_id uuid, row_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.app_users as u
        where u.user_id = auth.uid()
            and u.role = 'admin'
            and u.status = 'active'
    );
$$;

revoke execute on function audit.can_read(uuid, bigint) from public, anon;
grant execute on function audit.can_read(uuid, bigint) to authenticated;

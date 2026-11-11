-- Who may read the audit log (the second half of the audit trail; the log, its
-- triggers and its append-only guards are migration 20261110180000_create_audit_trail).

-- 1. WHO MAY READ A ROW

-- Whether the signed-in user may read log rows for `row_bill_id`: an active
-- admin reads everything; an active analyst or approver reads only rows of
-- bills they may read (a submitted bill, or their own draft - the rule in
-- backend/services/bill_access.py). security definer: app_users and bills have
-- row-level security and no policy for the caller.
create or replace function audit.can_read(row_bill_id uuid)
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
            and u.status = 'active'
            and (
                u.role = 'admin'
                or (
                    u.role in ('analyst', 'approver')
                    and row_bill_id is not null
                    and exists (
                        select 1
                        from public.bills as b
                        where b.bill_id = row_bill_id
                            and (b.status <> 'draft' or b.submitted_by = u.user_id)
                    )
                )
            )
    );
$$;

revoke execute on function audit.can_read(uuid) from public, anon;
grant execute on function audit.can_read(uuid) to authenticated;

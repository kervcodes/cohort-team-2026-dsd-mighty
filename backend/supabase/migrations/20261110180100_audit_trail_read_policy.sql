-- Who may read the audit log (the second half of the audit trail; the log, its
-- triggers and its append-only guards are migration 20261110180000_create_audit_trail).

-- 1. WHO MAY READ A ROW

-- Whether the signed-in user may read log row `row_id` of bill `row_bill_id`:
-- an active admin reads everything; an active analyst or approver reads only
-- rows of bills they may read (a submitted bill, or their own draft - the rule
-- in backend/services/bill_access.py). A row written while the bill was a
-- draft stays the submitter's after the bill is submitted: the bill's status
-- at that moment is the one captured by the latest bills row of the log at or
-- before `row_id` (the row itself, for a row on the bills table).
-- security definer: app_users and bills have row-level security and no policy
-- for the caller, and the log rows read here may not be the caller's.
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
                            and (
                                b.submitted_by = u.user_id
                                or (
                                    b.status <> 'draft'
                                    and coalesce(
                                        (
                                            select coalesce(r.new_row, r.old_row) ->> 'status'
                                            from audit.record_changes as r
                                            where r.bill_id = row_bill_id
                                                and r.table_schema = 'public'
                                                and r.table_name = 'bills'
                                                and r.id <= row_id
                                            order by r.id desc
                                            limit 1
                                        ),
                                        ''
                                    ) <> 'draft'
                                )
                            )
                    )
                )
            )
    );
$$;

revoke execute on function audit.can_read(uuid, bigint) from public, anon;
grant execute on function audit.can_read(uuid, bigint) to authenticated;

-- 2. THE POLICY AND THE GRANTS

alter table audit.record_changes enable row level security;

create policy record_changes_select
on audit.record_changes
for select
to authenticated
using (audit.can_read(bill_id, id));

-- Read-only: the backend (service role, which bypasses row-level security)
-- enforces the same bill_access scope in the route that serves a timeline.
grant usage on schema audit to authenticated, service_role;
grant select on audit.record_changes to authenticated, service_role;

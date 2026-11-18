-- Drop public.audit_events (DC-91).
--
-- The old business timeline table. Nothing writes to or reads from it; the
-- audit trail (audit.record_changes, migration 20261110180000) replaced it.
-- Its indexes, RLS setup and the prevent_audit_mutation trigger go with the
-- table; the TRUNCATE guard and the guard function are dropped explicitly.

drop trigger prevent_audit_events_truncate on public.audit_events;

drop table public.audit_events;

-- Only audit_events used it. (audit.prevent_changes guards the log.)
drop function public.prevent_audit_changes();

// Mirrors the audit API contract (DC-89): GET /audit/changes and
// GET /bills/{bill_id}/history.

export const auditTables = [
  "bills",
  "approvals",
  "payments",
  "vendors",
  "vendor_accounts",
  "properties",
  "app_users",
  "autopay_settings",
] as const;
export type AuditTable = (typeof auditTables)[number];

export type AuditAction = "created" | "changed" | "deleted";

// Who made a change. `id` and `name` are null for the system (no signed-in
// user), and `name` is null when the user is gone.
export type AuditActor = {
  id: string | null;
  name: string | null;
  role: string | null;
};

// A row as stored, with sensitive values already masked (e.g. "****0456").
export type AuditRow = Record<string, unknown>;

export type AuditChange = {
  id: number;
  occurred_at: string;
  // Any audited table: the filter offers `auditTables`, but a table audited
  // later is still listed.
  table: string;
  action: AuditAction;
  record_id: string | null;
  bill_id: string | null;
  actor: AuditActor;
  changed_fields: string[];
  before: AuditRow | null;
  after: AuditRow | null;
};

export type AuditChangesPage = {
  items: AuditChange[];
  // Pass as `before_id` for the next page; null when there are no more rows.
  next_before_id: number | null;
};

export type AuditChangesQuery = {
  table?: AuditTable;
  actor_id?: string;
  bill_id?: string;
  // YYYY-MM-DD, UTC day, both ends inclusive.
  from?: string;
  to?: string;
  before_id?: number;
  limit?: number;
};

export type BillHistoryActor = {
  id: string;
  name: string | null;
};

export type BillHistoryEvent = {
  at: string;
  kind: string;
  summary: string;
  detail: string | null;
  actor: BillHistoryActor | null;
  change_id: number | null;
  run_id: string | null;
};

export type BillHistory = {
  bill_id: string;
  // Oldest first.
  events: BillHistoryEvent[];
};

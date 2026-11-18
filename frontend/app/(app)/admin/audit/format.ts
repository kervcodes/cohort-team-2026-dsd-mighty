import type { AuditAction, AuditChange, AuditTable } from "@/types/audit";

export const TABLE_LABELS: Record<AuditTable, string> = {
  bills: "Bills",
  approvals: "Approvals",
  payments: "Payments",
  vendors: "Vendors",
  vendor_accounts: "Vendor accounts",
  properties: "Properties",
  app_users: "Users",
  autopay_settings: "Autopay settings",
};

export const ACTION_LABELS: Record<AuditAction, string> = {
  created: "Created",
  changed: "Changed",
  deleted: "Deleted",
};

// A table audited after this page was written still gets a readable name:
// "autopay_settings" -> "Autopay settings".
export function tableLabel(table: string): string {
  if (table in TABLE_LABELS) return TABLE_LABELS[table as AuditTable];
  const words = table.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const SYSTEM = "System";
export const UNKNOWN_USER = "Unknown user";

// The viewer's local date and time, e.g. "Nov 17, 2026, 3:08 PM".
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function actorName(actor: { id: string | null; name: string | null } | null): string {
  if (!actor?.id) return SYSTEM;
  return actor.name ?? UNKNOWN_USER;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

// Values are shown exactly as the API gives them (masked ones stay masked).
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export type FieldDiff = { field: string; before: unknown; after: unknown };

// Changed: only the changed fields. Created or deleted: every field of the row.
export function fieldDiffs(change: AuditChange): FieldDiff[] {
  const before = change.before ?? {};
  const after = change.after ?? {};
  const fields =
    change.action === "changed"
      ? change.changed_fields
      : Object.keys(change.action === "created" ? after : before);

  return fields.map((field) => ({ field, before: before[field], after: after[field] }));
}

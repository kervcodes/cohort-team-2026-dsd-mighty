import type { AuditChangesPage, AuditChangesQuery, BillHistory } from "@/types/audit";
import { apiRequest } from "./http";

// Admin only: 403 for anyone else. Newest first; pass `next_before_id` of a
// page as `before_id` to get the next one.
export function listAuditChanges(query: AuditChangesQuery = {}): Promise<AuditChangesPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();

  return apiRequest<AuditChangesPage>(
    `/audit/changes${qs ? `?${qs}` : ""}`,
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to view the audit log.",
      failed: "Unable to load the audit log",
    },
  );
}

// Admin only. Everything that happened to one bill, oldest first.
export function getBillHistory(billId: string): Promise<BillHistory> {
  return apiRequest<BillHistory>(
    `/bills/${encodeURIComponent(billId)}/history`,
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to view bill history.",
      failed: "Unable to load bill history",
    },
  );
}

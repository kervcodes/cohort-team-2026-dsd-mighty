import type { Approval, ApprovalDecisionPayload, ApprovalListParams } from "@/types/approval";
import { apiRequest } from "./http";

export function getApprovals(params: ApprovalListParams = {}): Promise<Approval[]> {
  const searchParams = new URLSearchParams();

  if (params.status) searchParams.set("status", params.status);
  if (params.bill_id) searchParams.set("bill_id", params.bill_id);
  if (params.skip !== undefined) searchParams.set("skip", String(params.skip));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));

  const query = searchParams.toString();
  const path = query ? `/approvals?${query}` : "/approvals";

  return apiRequest<Approval[]>(
    path,
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to view approvals.",
      failed: "Unable to load approvals",
    },
  );
}

export function decideApproval(
  approvalId: string,
  payload: ApprovalDecisionPayload,
): Promise<Approval> {
  return apiRequest<Approval>(
    `/approvals/${approvalId}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    {
      signedOut: "You must be signed in to review an invoice.",
      failed: "Unable to submit approval decision",
    },
  );
}

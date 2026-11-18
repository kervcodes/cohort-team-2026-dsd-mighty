export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalDecisionType = "approve" | "reject";

export type ApprovalReviewer = {
  id: string;
  full_name: string;
};

export type Approval = {
  id: string;
  bill_id: string;
  status: ApprovalStatus;
  reviewer: ApprovalReviewer | null;
  comments: string | null;
  requested_at: string | null;
  decided_at: string | null;
};

export type ApprovalDecisionPayload = {
  decision: ApprovalDecisionType;
  comments?: string | null;
};

export type ApprovalListParams = {
  status?: ApprovalStatus;
  bill_id?: string;
  skip?: number;
  limit?: number;
};

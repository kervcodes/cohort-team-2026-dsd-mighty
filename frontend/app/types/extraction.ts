// The response of POST /bills/extract: `ExtractionResult` in
// backend/src/backend/extraction/schema.py.

import type { AccountStatus } from "@/types/bill";

export type ExtractionStatus = "ready_for_review" | "needs_attention" | "not_an_invoice" | "failed";

export type Confidence = "high" | "medium" | "low";

export type Extracted = {
  value: string | null;
  evidence: string;
  confidence: Confidence;
};

export type ExtractedAccountStatus = Omit<Extracted, "value"> & {
  value: AccountStatus | null;
};

export type ExtractedLineItem = {
  description: Extracted;
  amount: Extracted;
};

export type BillExtraction = {
  document_type: "invoice" | "not_an_invoice";
  vendor_name: Extracted;
  account_number: Extracted;
  invoice_number: Extracted;
  invoice_date: Extracted;
  due_date: Extracted;
  amount_due: Extracted;
  previous_balance: Extracted;
  payments_received: Extracted;
  current_charges: Extracted;
  line_items: ExtractedLineItem[];
  service_address: Extracted;
  service_period_start: Extracted;
  service_period_end: Extracted;
  description: Extracted;
  payment_website: Extracted;
  account_status: ExtractedAccountStatus;
};

export type IssueCode =
  | "MISSING_REQUIRED"
  | "BAD_DATE"
  | "DUE_BEFORE_INVOICE"
  | "DATE_OUT_OF_RANGE"
  | "BAD_AMOUNT"
  | "BAD_URL"
  | "LINE_ITEMS_MISMATCH"
  | "BALANCE_MISMATCH"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_MISMATCH"
  | "LOW_CONFIDENCE"
  | "MODELS_DISAGREE";

export type ExtractionIssue = {
  code: IssueCode;
  // An extraction field name such as "amount_due" or "line_items[0].amount".
  field: string;
  // Written for developers: it names schema fields, never extracted values.
  message: string;
};

export type ExtractionResult = {
  status: ExtractionStatus;
  extraction: BillExtraction | null;
  issues: ExtractionIssue[];
  failed_reason: string | null;
  model: string | null;
  prompt_version: string | null;
  file_sha256: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
};

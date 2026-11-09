import { apiRequest } from "./http";

export type BillStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid"
  | "failed"
  | "exception";

export type AccountStatus = "unpaid" | "outstanding" | "paid";

export type BillCreatePayload = {
  account_number_raw: string;
  vendor_name_raw?: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  prev_payments?: string;
  description?: string;
  processing_notes?: string;
  property_address?: string;
  account_status?: AccountStatus;
  website_name?: string;
};

export type Bill = {
  id: string;
  account_number_raw: string;
  vendor_name_raw: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  prev_payments: string | null;
  description: string | null;
  processing_notes: string | null;
  property_address: string | null;
  account_status: AccountStatus | null;
  website_name: string | null;
  vendor_account_id: string | null;
  submitted_by: { id: string; full_name: string };
  status: BillStatus;
  exception_reason: string | null;
  document_path: string | null;
  created_at: string;
};

export function createBill(payload: BillCreatePayload): Promise<Bill> {
  return apiRequest<Bill>(
    "/bills",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { signedOut: "You must be signed in to submit an invoice.", failed: "Request failed" },
  );
}

export type DocumentUploadResponse = {
  bill_id: string;
  document_path: string;
  status: string;
};

// A dropped file can have an empty MIME type (the form accepts it by its
// .pdf extension). FormData would then send it as application/octet-stream
// and the backend would answer 415, so give it the PDF type explicitly. The
// backend still checks the %PDF- signature, so this cannot smuggle in a
// non-PDF.
export function withPdfType(file: File): File {
  return file.type ? file : new File([file], file.name, { type: "application/pdf" });
}

export function uploadInvoicePdf(file: File, billId: string): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  formData.append("file", withPdfType(file));

  return apiRequest<DocumentUploadResponse>(
    `/bills/${billId}/document`,
    { method: "POST", body: formData },
    { signedOut: "You must be signed in to upload a PDF.", failed: "Upload failed" },
  );
}

// `null` means "clear this field" on update; an omitted key leaves it as is.
export type BillDraftPayload = {
  account_number_raw?: string | null;
  invoice_number?: string | null;
  vendor_name_raw?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  amount?: string | null;
  prev_payments?: string | null;
  description?: string | null;
  processing_notes?: string | null;
  property_address?: string | null;
  account_status?: AccountStatus | null;
  website_name?: string | null;
};

export type BillDraftResponse = {
  bill_id: string;
  status: "draft";
  document_path: string | null;
};

function sendDraft(
  method: "POST" | "PATCH",
  path: string,
  payload: BillDraftPayload,
): Promise<BillDraftResponse> {
  return apiRequest<BillDraftResponse>(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { signedOut: "You must be signed in to save a draft.", failed: "Unable to save draft" },
  );
}

export function saveBillDraft(payload: BillDraftPayload): Promise<BillDraftResponse> {
  return sendDraft("POST", "/bills/drafts", payload);
}

export function updateBillDraft(
  billId: string,
  payload: BillDraftPayload,
): Promise<BillDraftResponse> {
  return sendDraft("PATCH", `/bills/${billId}/draft`, payload);
}

export type DashboardBill = {
  bill_id: string;
  invoice_number: string | null;
  property_address: string | null;
  vendor_name_raw: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  status: BillStatus;
  document_path: string | null;
  created_at: string;
};

export function getDashboardBills(): Promise<DashboardBill[]> {
  return apiRequest<DashboardBill[]>(
    "/bills/dashboard",
    { method: "GET", cache: "no-store" },
    { signedOut: "You must be signed in to view invoices.", failed: "Unable to load invoices" },
  );
}

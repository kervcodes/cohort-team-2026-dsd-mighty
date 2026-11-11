import type {
  Bill,
  BillCreatePayload,
  BillDraftDetail,
  BillDraftPayload,
  BillDraftResponse,
  DashboardBill,
  DocumentUploadResponse,
} from "@/types/bill";
import { apiRequest } from "./http";

export function createBill(payload: BillCreatePayload): Promise<Bill> {
  return apiRequest<Bill>(
    "/bills",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    {
      signedOut: "You must be signed in to submit an invoice.",
      failed: "Request failed",
    },
  );
}

// A dropped file can have an empty MIME type (the form accepts it by its
// .pdf extension). FormData would then send it as application/octet-stream.
// The backend still checks the %PDF- signature.
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

export function getDashboardBills(): Promise<DashboardBill[]> {
  return apiRequest<DashboardBill[]>(
    "/bills/dashboard",
    { method: "GET", cache: "no-store" },
    { signedOut: "You must be signed in to view invoices.", failed: "Unable to load invoices" },
  );
}

export function getBillDraft(billId: string): Promise<BillDraftDetail> {
  return apiRequest<BillDraftDetail>(
    `/bills/${billId}/draft`,
    { method: "GET", cache: "no-store" },
    { signedOut: "You must be signed in to view a draft.", failed: "Unable to load draft" },
  );
}

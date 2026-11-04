// Read per request, not at import: a module-level throw breaks every importer
// (including tests) whenever the variable is unset. Keep the literal
// `process.env.NEXT_PUBLIC_API_URL` so Next.js can inline it at build time.
function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is missing. Check .env.local");
  }
  return url;
}

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

export async function createBill(payload: BillCreatePayload): Promise<Bill> {
  const url = `${apiUrl()}/bills`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Unable to reach the backend. Check your connection and try again.");
  }

  if (!res.ok) {
    const error = await res.json().catch(() => null);

    throw new Error(error?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export type DocumentUploadResponse = {
  bill_id: string;
  document_path: string;
  status: string;
};

export async function uploadInvoicePdf(
  file: File,
  billId: string,
): Promise<DocumentUploadResponse> {
  const supabase = createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("You must be signed in to upload a PDF.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${apiUrl()}/bills/${billId}/document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);

    throw new Error(
      typeof error?.detail === "string" ? error.detail : `Upload failed (${response.status})`,
    );
  }

  return response.json();
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

import { createClient } from "@/lib/supabase/client";

// FastAPI returns `detail` as a string for HTTPException and as a list of
// field errors for request validation (422).
function errorDetail(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: { loc?: unknown[]; msg?: string }) => {
        const field = item.loc?.at(-1);
        return item.msg ? (field ? `${String(field)}: ${item.msg}` : item.msg) : null;
      })
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return null;
}

async function sendDraft(
  method: "POST" | "PATCH",
  path: string,
  payload: BillDraftPayload,
): Promise<BillDraftResponse> {
  const supabase = createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("You must be signed in to save a draft.");
  }

  const url = `${apiUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // The browser hides the real cause: backend down, CORS rejection, or an
    // unhandled 500 (FastAPI's 500 responses carry no CORS headers).
    throw new Error(
      "Unable to reach the backend. It may be down or returned a server error — check the backend logs.",
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new Error(errorDetail(body) ?? `Unable to save draft (${response.status})`);
  }

  return response.json();
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

// POST /bills/extract (DC-52): the server reads the bill with AI and returns
// values for the form. Nothing is stored; the analyst reviews, then saves.
export type ExtractionStatus = "ready_for_review" | "needs_attention" | "not_an_invoice" | "failed";

export type ExtractionIssue = { code: string; field: string; message: string };

// BillCreate field names; dates are YYYY-MM-DD, amounts decimal strings.
export type ExtractedBillFields = {
  vendor_name_raw: string | null;
  account_number_raw: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: string | null;
  prev_payments: string | null;
  property_address: string | null;
  description: string | null;
  processing_notes: string | null;
};

export type ExtractResponse = {
  status: ExtractionStatus;
  fields: ExtractedBillFields | null;
  issues: ExtractionIssue[];
  failed_reason: string | null;
};

export async function extractBill(file: File): Promise<ExtractResponse> {
  const supabase = createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("You must be signed in to read a bill.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const url = `${apiUrl()}/bills/extract`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
  } catch {
    throw new Error("Unable to reach the backend to read the bill.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(errorDetail(body) ?? `Unable to read the bill (${response.status})`);
  }

  return response.json();
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

export async function getDashboardBills(): Promise<DashboardBill[]> {
  const supabase = createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("You must be signed in to view invoices.");
  }

  const response = await fetch(`${apiUrl()}/bills/dashboard`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);

    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : `Unable to load invoices (${response.status})`,
    );
  }

  return response.json();
}

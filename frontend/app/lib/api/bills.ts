import { createClient } from "@/lib/supabase/client";
import type {
  Bill,
  BillCreatePayload,
  BillDraftDetail,
  BillDraftPayload,
  BillDraftResponse,
  DashboardBill,
  DocumentUploadResponse,
} from "@/types/bill";

// Read per request, not at import: a module-level throw breaks every
// importer (including tests) whenever the variable is unset.
// Keep the literal process.env reference for Next.js build-time inlining.
function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;

  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is missing. Check .env.local");
  }

  return url;
}

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

// A dropped file can have an empty MIME type (the form accepts it by its
// .pdf extension). FormData would then send it as application/octet-stream.
// The backend still checks the %PDF- signature.
export function withPdfType(file: File): File {
  return file.type ? file : new File([file], file.name, { type: "application/pdf" });
}

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
  formData.append("file", withPdfType(file));

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

// FastAPI returns `detail` as a string for HTTPException and as a list
// of field errors for request validation (422).
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
    throw new Error(
      "Unable to reach the backend. It may be down or returned a server error. Check the backend logs.",
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

export async function getBillDraft(billId: string): Promise<BillDraftDetail> {
  const supabase = createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("You must be signed in to view a draft.");
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl()}/bills/${billId}/draft`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Unable to reach the backend. It may be down or returned a server error. Check the backend logs.",
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new Error(errorDetail(body) ?? `Unable to load draft (${response.status})`);
  }

  return response.json();
}

import { createClient } from "@/lib/supabase/client";

export const NETWORK_ERROR_MESSAGE =
  "Unable to reach the server. It may be down or had an error - try again in a moment.";

// Read per request, not at import: a module-level throw breaks every importer
// (including tests) whenever the variable is unset. Keep the literal
// `process.env.NEXT_PUBLIC_API_URL` so Next.js can inline it at build time.
export function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is missing. Check .env.local");
  }
  return url;
}

// FastAPI returns `detail` as a string for HTTPException and as a list of
// field errors for request validation (422).
export function errorDetail(body: unknown): string | null {
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

// A failed response from the backend, with its HTTP status for callers that
// treat one status specially. Its message is safe to show, like any other.
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ApiMessages = {
  // Shown when there is no Supabase session to send, e.g. "You must be signed in to ...".
  signedOut: string;
  // Shown with the status code when an error response carries no FastAPI detail.
  failed: string;
};

type ApiInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

// Calls the FastAPI backend as the signed-in user and returns the parsed JSON
// body. Every failure is an Error whose message can be shown to the user.
export async function apiRequest<T>(
  path: string,
  init: ApiInit,
  messages: ApiMessages,
): Promise<T> {
  const url = `${apiUrl()}${path}`;

  const {
    data: { session },
    error: sessionError,
  } = await createClient().auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error(messages.signedOut);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` },
    });
  } catch {
    // The browser hides the real cause: backend down, CORS rejection, or an
    // unhandled 500 (FastAPI's 500 responses carry no CORS headers).
    throw new Error(NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new ApiError(
      errorDetail(body) ?? `${messages.failed} (${response.status})`,
      response.status,
    );
  }

  return response.json();
}

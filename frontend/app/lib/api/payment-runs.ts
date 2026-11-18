import type { PaymentRun } from "@/types/payment-run";
import { apiRequest } from "./http";

// Queues a "Pay with AI" run for an approved bill. The payment agent worker
// picks it up; poll `getPaymentRun` to follow it. Fails with an ApiError of
// 409 (bill not approved, or a run already queued or running) or 422 (no
// matched vendor account, no portal login, or an inactive account).
export function startPaymentRun(billId: string): Promise<PaymentRun> {
  return apiRequest<PaymentRun>(
    `/bills/${billId}/payment-runs`,
    { method: "POST" },
    {
      signedOut: "You must be signed in to pay a bill.",
      failed: "Unable to start the payment run",
    },
  );
}

// The bill's payment runs, newest first.
export function listPaymentRuns(billId: string): Promise<PaymentRun[]> {
  return apiRequest<PaymentRun[]>(
    `/bills/${billId}/payment-runs`,
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to view payment runs.",
      failed: "Unable to load payment runs",
    },
  );
}

// One run, fresh from the server; `signal` stops waiting for it.
export function getPaymentRun(runId: string, signal?: AbortSignal): Promise<PaymentRun> {
  return apiRequest<PaymentRun>(
    `/payment-runs/${runId}`,
    { method: "GET", cache: "no-store", signal },
    {
      signedOut: "You must be signed in to view a payment run.",
      failed: "Unable to load the payment run",
    },
  );
}

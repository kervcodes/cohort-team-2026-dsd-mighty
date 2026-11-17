import type { Payment, PaymentCreatePayload } from "@/types/payment";
import { apiRequest } from "./http";

// Records one payment attempt. A completed payment marks the bill paid; a
// failed one leaves it approved. Throws an ApiError with status 409 when the
// bill is not approved or already paid, and 422 when a completed amount is
// not the bill amount.
export function recordPayment(billId: string, body: PaymentCreatePayload): Promise<Payment> {
  return apiRequest<Payment>(
    `/bills/${billId}/payments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    {
      signedOut: "You must be signed in to record a payment.",
      failed: "Unable to record the payment",
    },
  );
}

// The bill's payment attempts, newest first.
export function listPayments(billId: string): Promise<Payment[]> {
  return apiRequest<Payment[]>(
    `/bills/${billId}/payments`,
    { method: "GET", cache: "no-store" },
    { signedOut: "You must be signed in to view payments.", failed: "Unable to load payments" },
  );
}

import type { PaymentMethod } from "@/lib/api/vendors";

export type { PaymentMethod };

// Mirrors backend/src/backend/schemas/payment.py PaymentStatus.
export type PaymentStatus = "pending" | "completed" | "failed";

// Backend PaymentRead. `amount` is a decimal string, such as "1250.00".
export type Payment = {
  id: string;
  bill_id: string;
  amount: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  paid_on: string | null;
  reference: string | null;
  failure_reason: string | null;
  attempt_number: number;
  recorded_by: string;
  created_at: string;
};

type PaymentAttempt = {
  amount: string;
  payment_method: PaymentMethod;
  // YYYY-MM-DD, at most tomorrow in UTC.
  paid_on: string;
  reference: string | null;
};

// Body of POST /bills/{bill_id}/payments (backend PaymentCreate). A failed
// attempt always has a reason and a completed payment never does.
export type PaymentCreatePayload =
  | (PaymentAttempt & { outcome: "completed" })
  | (PaymentAttempt & { outcome: "failed"; failure_reason: string });

export type PaymentOutcome = PaymentCreatePayload["outcome"];

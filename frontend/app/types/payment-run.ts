// Mirrors backend/src/backend/schemas/payment_run.py (DC-84).

export const paymentRunStatuses = ["queued", "running", "paid", "failed", "flagged"] as const;
export type PaymentRunStatus = (typeof paymentRunStatuses)[number];

// A run in one of these states is still being worked on; the others are final.
export type ActivePaymentRunStatus = Extract<PaymentRunStatus, "queued" | "running">;

export function isActiveRunStatus(status: PaymentRunStatus): status is ActivePaymentRunStatus {
  return status === "queued" || status === "running";
}

// What queued a run: someone pressed Pay with AI, or autopay queued it after
// an approval (`started_by` is then the approver).
export type PaymentRunTrigger = "manual" | "autopay";

// One line of what the agent did. `step` is a machine name such as "sign_in";
// `detail` is a sentence written for people.
export type PaymentRunStep = {
  at: string;
  step: string;
  detail: string;
};

// What the vendor portal's receipt said. `amount` is a decimal string.
export type PaymentRunReceipt = {
  confirmation_number: string;
  bill_number: string;
  amount: string;
  paid_on: string;
  outcome: "successful" | "declined";
  portal: string;
};

export type PaymentRun = {
  id: string;
  bill_id: string;
  started_by: string;
  // The starter's full name, from their account. The API always sends it;
  // null only if that account were gone.
  started_by_name: string | null;
  trigger: PaymentRunTrigger;
  status: PaymentRunStatus;
  steps: PaymentRunStep[];
  // Set exactly when the run is flagged.
  flag_reason: string | null;
  // Set when the portal answered the payment (paid or failed).
  receipt: PaymentRunReceipt | null;
  payment_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

import type { PaymentCreatePayload, PaymentMethod, PaymentOutcome } from "@/types/payment";

export const FORM_ERRORS = {
  paidOnRequired: "Enter the date paid.",
  paidOnInFuture: "The date can't be in the future.",
  failureReasonRequired: "Say what went wrong.",
};

export type PaymentFormValues = {
  method: PaymentMethod;
  paidOn: string;
  reference: string;
  failureReason: string;
};

export type PaymentFormErrors = Partial<Record<"paidOn" | "failureReason", string>>;

// YYYY-MM-DD from the date's own fields. `toISOString` would give the UTC
// date, which is tomorrow or yesterday for part of every day.
function isoDate(year: number, monthIndex: number, day: number): string {
  // Date.UTC rolls an overflowing day into the next month and year.
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function localToday(now: Date = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

// The latest date the backend accepts is tomorrow in UTC (somewhere it is
// already that day). Capped at the user's own tomorrow, so the picker never
// offers a day the server would refuse, and never refuses the user's today.
export function latestPaidOn(now: Date = new Date()): string {
  const localTomorrow = isoDate(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const utcTomorrow = isoDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return localTomorrow < utcTomorrow ? localTomorrow : utcTomorrow;
}

export function defaultPaymentValues(now: Date = new Date()): PaymentFormValues {
  return { method: "ach", paidOn: localToday(now), reference: "", failureReason: "" };
}

export function validatePaymentForm(
  values: PaymentFormValues,
  outcome: PaymentOutcome,
  latest: string,
): PaymentFormErrors {
  const errors: PaymentFormErrors = {};
  if (!values.paidOn) {
    errors.paidOn = FORM_ERRORS.paidOnRequired;
  } else if (values.paidOn > latest) {
    errors.paidOn = FORM_ERRORS.paidOnInFuture;
  }
  if (outcome === "failed" && !values.failureReason.trim()) {
    errors.failureReason = FORM_ERRORS.failureReasonRequired;
  }
  return errors;
}

// The amount is always the full bill amount: the backend refuses any other
// amount for a completed payment.
export function toPaymentPayload(
  values: PaymentFormValues,
  outcome: PaymentOutcome,
  billAmount: string | number,
): PaymentCreatePayload {
  const attempt = {
    amount: typeof billAmount === "number" ? billAmount.toFixed(2) : billAmount,
    payment_method: values.method,
    paid_on: values.paidOn,
    reference: values.reference.trim() || null,
  };
  return outcome === "failed"
    ? { ...attempt, outcome, failure_reason: values.failureReason.trim() }
    : { ...attempt, outcome };
}

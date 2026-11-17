"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import { paymentMethodLabels, paymentMethods } from "@/lib/api/vendors";
import { formatUsd } from "@/lib/format";
import type { PaymentCreatePayload, PaymentMethod, PaymentOutcome } from "@/types/payment";
import {
  defaultPaymentValues,
  latestPaidOn,
  type PaymentFormErrors,
  type PaymentFormValues,
  toPaymentPayload,
  validatePaymentForm,
} from "./payment-form";

const COPY = {
  closeDialog: "Close dialog",
  amount: "Amount",
  method: "Payment method",
  optional: "Optional",
  reference: "Reference",
  referencePlaceholder: "Confirmation or check number",
  failureReason: "What went wrong",
  failureReasonPlaceholder: "For example, the bank returned it",
  cancel: "Cancel",
  saving: "Saving...",
  completed: {
    title: "Mark as paid",
    paidOn: "Date paid",
    submit: "Mark as paid",
    switchTo: "Record a failed attempt instead",
  },
  failed: {
    title: "Record a failed attempt",
    paidOn: "Date attempted",
    submit: "Record failed attempt",
    switchTo: "Record a completed payment instead",
  },
};

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea";

type Props = {
  billAmount: string | number;
  saving: boolean;
  // The server's answer to the last submit, shown above the buttons.
  error: string | null;
  // The server refused the payment for good (409), so submitting again can't help.
  blocked: boolean;
  onSubmit: (payload: PaymentCreatePayload) => void;
  onClose: () => void;
};

// Mounted while open: every opening starts from the defaults, dated today.
export function MarkAsPaidDialog({ billAmount, saving, error, blocked, onSubmit, onClose }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const methodRef = useRef<HTMLSelectElement>(null);
  const failureReasonRef = useRef<HTMLTextAreaElement>(null);
  const [latest] = useState(() => latestPaidOn());
  const [values, setValues] = useState<PaymentFormValues>(() => defaultPaymentValues());
  const [outcome, setOutcome] = useState<PaymentOutcome>("completed");
  const [errors, setErrors] = useState<PaymentFormErrors>({});
  const copy = COPY[outcome];

  // While saving, the request can't be called back, so the dialog stays open.
  const close = () => {
    if (!saving) onClose();
  };

  useEffect(() => {
    if (saving) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saving, onClose]);

  // Focus starts on the first field and goes back to where it was on close,
  // if that is still on the page (the button is gone once the bill is paid).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    methodRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  // Tab and Shift+Tab cycle inside the dialog.
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function update<K extends keyof PaymentFormValues>(key: K, value: PaymentFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function switchOutcome() {
    const next = outcome === "completed" ? "failed" : "completed";
    setOutcome(next);
    setErrors({});
  }

  // The reason is the one field left to fill in, so go straight to it.
  useEffect(() => {
    if (outcome === "failed") failureReasonRef.current?.focus();
  }, [outcome]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || blocked) return;
    const found = validatePaymentForm(values, outcome, latest);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(toPaymentPayload(values, outcome, billAmount));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={COPY.closeDialog}
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapFocus}
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-xl font-semibold text-foreground">
          {copy.title}
        </h2>

        <form noValidate onSubmit={submit} className="mt-5 space-y-4">
          <dl>
            <dt className="text-sm font-medium text-foreground">{COPY.amount}</dt>
            <dd className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {formatUsd(billAmount)}
            </dd>
          </dl>

          <FormField label={COPY.method} htmlFor="payment-method">
            {(field) => (
              <select
                {...field}
                ref={methodRef}
                value={values.method}
                onChange={(event) => update("method", event.target.value as PaymentMethod)}
                className={inputClass}
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {paymentMethodLabels[method]}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label={copy.paidOn} htmlFor="payment-paid-on" error={errors.paidOn}>
            {(field) => (
              <input
                {...field}
                type="date"
                required
                max={latest}
                value={values.paidOn}
                onChange={(event) => update("paidOn", event.target.value)}
                className={inputClass}
              />
            )}
          </FormField>

          <FormField label={COPY.reference} htmlFor="payment-reference" hint={COPY.optional}>
            {(field) => (
              <input
                {...field}
                type="text"
                maxLength={200}
                autoComplete="off"
                placeholder={COPY.referencePlaceholder}
                value={values.reference}
                onChange={(event) => update("reference", event.target.value)}
                className={inputClass}
              />
            )}
          </FormField>

          {outcome === "failed" && (
            <FormField
              label={COPY.failureReason}
              htmlFor="payment-failure-reason"
              error={errors.failureReason}
            >
              {(field) => (
                <textarea
                  {...field}
                  ref={failureReasonRef}
                  required
                  rows={3}
                  maxLength={1000}
                  placeholder={COPY.failureReasonPlaceholder}
                  value={values.failureReason}
                  onChange={(event) => update("failureReason", event.target.value)}
                  className={`${inputClass} resize-y`}
                />
              )}
            </FormField>
          )}

          <button
            type="button"
            onClick={switchOutcome}
            disabled={saving}
            className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copy.switchTo}
          </button>

          {error && (
            <p
              role="alert"
              className="rounded border border-overdue px-3 py-2 text-sm text-overdue"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button label={COPY.cancel} variant="secondary" onClick={close} disabled={saving} />
            <Button
              type="submit"
              label={saving ? COPY.saving : copy.submit}
              disabled={saving || blocked}
              aria-busy={saving}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

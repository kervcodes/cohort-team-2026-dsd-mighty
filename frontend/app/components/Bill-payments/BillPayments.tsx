"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { ApiError } from "@/lib/api/http";
import { listPayments, recordPayment } from "@/lib/api/payments";
import { paymentMethodLabels } from "@/lib/api/vendors";
import { formatDay, formatUsd } from "@/lib/format";
import type { BillStatus } from "@/types/bill";
import type { Payment, PaymentCreatePayload, PaymentStatus } from "@/types/payment";
import { MarkAsPaidDialog } from "./MarkAsPaidDialog";

const COPY = {
  title: "Payment history",
  markAsPaid: "Mark as paid",
  explainer: "Paid outside the app? Record the payment here.",
  paidOn: (day: string) => `Paid on ${day}`,
  history: "Payment history",
  loadFailed: "Unable to load payments.",
  saveFailed: "Unable to save the payment. Try again.",
  tryAgain: "Try again",
  reference: (reference: string) => `Reference ${reference}`,
  separator: "\u00b7",
};

const RESULTS: Record<PaymentStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-paid-bg text-paid" },
  failed: { label: "Failed", className: "bg-overdue-bg text-overdue" },
  pending: { label: "Pending", className: "bg-pending-bg text-pending" },
};

// One attempt: the amount and its result, then when, how and the reference,
// and why it failed. A list, not a table, so it fits half the page.
function PaymentItem({ payment }: { payment: Payment }) {
  const result = RESULTS[payment.payment_status];
  const details = [
    payment.paid_on ? formatDay(payment.paid_on) : null,
    paymentMethodLabels[payment.payment_method],
    payment.reference ? COPY.reference(payment.reference) : null,
  ].filter((detail) => detail !== null);

  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold tabular-nums text-foreground">{formatUsd(payment.amount)}</p>
          <p className="text-foreground-muted wrap-anywhere">
            {details.join(` ${COPY.separator} `)}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${result.className}`}
        >
          {result.label}
        </span>
      </div>
      {payment.failure_reason && (
        <p className="mt-1 text-foreground wrap-anywhere">{payment.failure_reason}</p>
      )}
    </li>
  );
}

type Props = {
  billId: string;
  // The full bill amount, which a completed payment must match.
  billAmount: string | number;
  billStatus: BillStatus;
  // Called once the bill is known to be paid: after a completed payment here,
  // or when the history shows one the page doesn't know about yet.
  onPaid?: (payment: Payment) => void;
};

/**
 * The bill's payment history, and for an active approver or admin a "Mark as
 * paid" button while the bill is approved. Renders nothing while there is
 * nothing to show.
 */
export function BillPayments({ billId, billAmount, billStatus, onPaid }: Props) {
  const headingId = useId();
  const paidRef = useRef<HTMLParagraphElement>(null);
  const { profile, loading: accountLoading } = useAuth();
  // The backend refuses POST /payments from anyone else; this only hides the button.
  const canRecord =
    !accountLoading &&
    profile?.status === "active" &&
    (profile.role === "approver" || profile.role === "admin");

  // Tagged with its bill, so a new `billId` never shows the last bill's payments.
  const [history, setHistory] = useState<{ billId: string; payments: Payment[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The server's 409: the bill can't be paid (any more), whatever the page says.
  const [conflict, setConflict] = useState<string | null>(null);
  const [focusPaid, setFocusPaid] = useState(false);

  const payments = history?.billId === billId ? history.payments : null;
  const completed = payments?.find((payment) => payment.payment_status === "completed") ?? null;
  const isPaid = billStatus === "paid" || completed !== null;
  const canPay = canRecord && billStatus === "approved" && !isPaid && conflict === null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` re-runs the load, and so does a new `billStatus` (a bill paid elsewhere, such as by Pay with AI, has a payment to show)
  useEffect(() => {
    let cancelled = false;
    listPayments(billId)
      .then((result) => {
        if (cancelled) return;
        setHistory({ billId, payments: result });
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : COPY.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [billId, billStatus, reload]);

  // Tell the page once per completed payment, however it was found.
  const notifiedPaymentId = useRef<string | null>(null);
  useEffect(() => {
    if (!completed || billStatus === "paid" || notifiedPaymentId.current === completed.id) return;
    notifiedPaymentId.current = completed.id;
    onPaid?.(completed);
  }, [completed, billStatus, onPaid]);

  // The button that opened the dialog is gone once the bill is paid, so focus
  // goes to the paid state instead.
  useEffect(() => {
    if (focusPaid && isPaid) {
      paidRef.current?.focus();
      setFocusPaid(false);
    }
  }, [focusPaid, isPaid]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setSaveError(null);
  }, []);

  async function submitPayment(payload: PaymentCreatePayload) {
    setSaving(true);
    setSaveError(null);
    try {
      const payment = await recordPayment(billId, payload);
      setHistory((current) => ({
        billId,
        payments: [payment, ...(current?.billId === billId ? current.payments : [])],
      }));
      setDialogOpen(false);
      setFocusPaid(payment.payment_status === "completed");
      setReload((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Paid or moved on elsewhere: say why, and show what was recorded.
        setSaveError(err.message);
        setConflict(err.message);
        setReload((n) => n + 1);
      } else if (err instanceof ApiError && err.status === 422) {
        setSaveError(err.message);
      } else {
        setSaveError(COPY.saveFailed);
      }
    } finally {
      setSaving(false);
    }
  }

  const hasHistory = payments !== null && payments.length > 0;
  // A refresh that fails keeps the list on screen; only a first load shows its error.
  const showLoadError = payments === null && loadError !== null;
  if (!isPaid && !canPay && !conflict && !hasHistory && !showLoadError && !dialogOpen) {
    return null;
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-surface p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={headingId} className="text-lg font-semibold text-foreground">
          {COPY.title}
        </h3>
        {isPaid && (
          <p
            ref={paidRef}
            tabIndex={-1}
            className="flex items-center gap-2 rounded text-sm text-foreground-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatusBadge status="paid" />
            {completed?.paid_on && <span>{COPY.paidOn(formatDay(completed.paid_on))}</span>}
          </p>
        )}
      </div>

      {conflict && !isPaid && <p className="mt-4 text-sm text-foreground-muted">{conflict}</p>}

      {showLoadError && (
        <div role="alert" className="mt-4 flex flex-col items-start gap-3">
          <p className="text-sm text-overdue">{loadError}</p>
          <Button
            label={COPY.tryAgain}
            variant="secondary"
            onClick={() => setReload((n) => n + 1)}
          />
        </div>
      )}

      {hasHistory && (
        <ul
          aria-label={COPY.history}
          className="mt-4 divide-y divide-border rounded-lg border border-border"
        >
          {payments.map((payment) => (
            <PaymentItem key={payment.id} payment={payment} />
          ))}
        </ul>
      )}

      {canPay && (
        <div
          className={`mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${
            hasHistory || showLoadError ? "border-t border-border pt-4" : ""
          }`}
        >
          <p className="text-sm text-foreground-muted">{COPY.explainer}</p>
          <Button
            label={COPY.markAsPaid}
            onClick={() => setDialogOpen(true)}
            className="w-full shrink-0 sm:w-auto"
          />
        </div>
      )}

      {dialogOpen && (
        <MarkAsPaidDialog
          billAmount={billAmount}
          saving={saving}
          error={saveError}
          blocked={conflict !== null}
          onSubmit={submitPayment}
          onClose={closeDialog}
        />
      )}
    </section>
  );
}

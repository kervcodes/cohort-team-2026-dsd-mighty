"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { DataTable, type DataTableColumn } from "@/components/DataTable/DataTable";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { ApiError } from "@/lib/api/http";
import { listPayments, recordPayment } from "@/lib/api/payments";
import { paymentMethodLabels } from "@/lib/api/vendors";
import { formatDay, formatUsd } from "@/lib/format";
import type { BillStatus } from "@/types/bill";
import type { Payment, PaymentCreatePayload, PaymentStatus } from "@/types/payment";
import { MarkAsPaidDialog } from "./MarkAsPaidDialog";

const COPY = {
  title: "Payments",
  markAsPaid: "Mark as paid",
  paidOn: (day: string) => `Paid on ${day}`,
  history: "Payment history",
  loading: "Loading payments...",
  empty: "No payments yet.",
  loadFailed: "Unable to load payments.",
  saveFailed: "Unable to save the payment. Try again.",
  notSet: "-",
  date: "Date",
  method: "Method",
  reference: "Reference",
  amount: "Amount",
  result: "Result",
};

const RESULTS: Record<PaymentStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-paid-bg text-paid" },
  failed: { label: "Failed", className: "bg-overdue-bg text-overdue" },
  pending: { label: "Pending", className: "bg-pending-bg text-pending" },
};

// Short values stay on one line; the table scrolls sideways in its card on a phone.
const oneLine = (value: string) => <span className="whitespace-nowrap">{value}</span>;

const columns: DataTableColumn<Payment>[] = [
  {
    header: COPY.date,
    cell: (payment) => oneLine(payment.paid_on ? formatDay(payment.paid_on) : COPY.notSet),
  },
  { header: COPY.method, cell: (payment) => oneLine(paymentMethodLabels[payment.payment_method]) },
  { header: COPY.reference, cell: (payment) => oneLine(payment.reference ?? COPY.notSet) },
  {
    header: COPY.amount,
    align: "right",
    cell: (payment) => (
      <span className="whitespace-nowrap tabular-nums">{formatUsd(payment.amount)}</span>
    ),
  },
  {
    header: COPY.result,
    cell: (payment) => {
      const result = RESULTS[payment.payment_status];
      return (
        <div className="space-y-1">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${result.className}`}
          >
            {result.label}
          </span>
          {payment.failure_reason && (
            <p className="max-w-xs break-words text-xs text-foreground-muted">
              {payment.failure_reason}
            </p>
          )}
        </div>
      );
    },
  },
];

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` re-runs the load
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
  }, [billId, reload]);

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

  let action: ReactNode = null;
  if (isPaid) {
    action = (
      <p
        ref={paidRef}
        tabIndex={-1}
        className="flex items-center gap-2 rounded text-sm text-foreground-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StatusBadge status="paid" />
        {completed?.paid_on && <span>{COPY.paidOn(formatDay(completed.paid_on))}</span>}
      </p>
    );
  } else if (canPay) {
    action = <Button label={COPY.markAsPaid} onClick={() => setDialogOpen(true)} />;
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-foreground">
          {COPY.title}
        </h2>
        {action}
      </div>

      {conflict && !isPaid && <p className="text-sm text-foreground-muted">{conflict}</p>}

      {(hasHistory || showLoadError) && (
        <DataTable
          label={COPY.history}
          columns={columns}
          rows={payments ?? []}
          getRowKey={(payment) => payment.id}
          emptyMessage={COPY.empty}
          error={showLoadError ? loadError : null}
          onRetry={() => setReload((n) => n + 1)}
        />
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

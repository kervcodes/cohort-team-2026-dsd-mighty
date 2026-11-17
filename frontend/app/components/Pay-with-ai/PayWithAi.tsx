"use client";

import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button/Button";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import type { BillStatus } from "@/types/bill";
import { isActiveRunStatus, type PaymentRun, type PaymentRunStep } from "@/types/payment-run";
import { EMPTY_VALUE, formatDateTime, formatDay, formatMoney, formatTime } from "./format";
import { type StartError, usePaymentRuns } from "./usePaymentRuns";

const COPY = {
  heading: "AI payment",
  explainer: "Claude signs in to the vendor's portal and pays this bill. You can watch each step.",
  pay: "Pay with AI",
  starting: "Starting...",
  confirmTitle: "Start a payment run for this bill?",
  confirmBody: "Claude will sign in to the vendor's portal and pay the approved amount.",
  confirmStart: "Start",
  tryAgain: "Try again",
  loading: "Loading payment runs...",
  // Shown under a 409 or 422 from starting a run, after the server's message.
  conflictHelp: "Reload the page to see this bill's latest status.",
  setupHelp: "Claude can't pay this bill until that's fixed. Then try again.",
  queuedTitle: "Waiting for the worker",
  queuedHint: "Claude starts in a moment. This updates on its own.",
  runningTitle: "Paying on the portal",
  runningHint: "Claude is working on the vendor's portal. This updates on its own.",
  pollFailing: "Can't reach the server right now. Still trying.",
  paidTitle: "Paid",
  paidHint: "Claude paid this bill on the vendor's portal.",
  failedTitle: "The portal declined the payment",
  failedHint: "Nothing was paid and the bill stays approved.",
  flaggedTitle: (reason: string) => `Needs a person: ${reason}`,
  flaggedHint: "Claude stopped. Read the steps before trying again.",
  confirmationNumber: "Confirmation number",
  amount: "Amount",
  paidOn: "Paid on",
  portalReference: (reference: string) => `Portal reference: ${reference}`,
  steps: "Steps",
  showSteps: (count: number) => `Show steps (${count})`,
  noSteps: "No steps yet.",
  started: (when: string, who: string | null) =>
    who ? `Started ${when} by ${who}` : `Started ${when}`,
  finished: (when: string) => `Finished ${when}`,
  notFinished: "Not finished",
  you: "you",
  separator: "\u00b7",
  earlierRuns: "Earlier runs",
};

// The roles the backend lets start a run (PAYMENT_WRITERS).
const PAYERS = new Set(["approver", "admin"]);

type Props = {
  billId: string;
  billStatus: BillStatus;
  // Called once when a run this component is watching ends paid, so the
  // page can reload the bill (it is now paid).
  onPaid?: () => void;
};

/**
 * "Pay with AI" for one bill: approvers and admins start a payment run on an
 * approved bill and watch it live; everyone who can read the bill sees its
 * latest run and earlier ones. Renders nothing when there is no run to show
 * and the viewer can't start one.
 */
export default function PayWithAi({ billId, billStatus, onPaid }: Props) {
  const headingId = useId();
  const { profile, loading: authLoading } = useAuth();
  const { runs, loadError, reload, pollFailing, start, starting, startError, clearStartError } =
    usePaymentRuns(billId, onPaid);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Unknown until the profile loads, so the button never flashes for analysts.
  const canPay = !authLoading && profile?.status === "active" && PAYERS.has(profile.role);
  const canStartHere = canPay && billStatus === "approved";

  const latest = runs?.[0] ?? null;
  const earlier = runs?.slice(1) ?? [];
  const latestActive = latest !== null && isActiveRunStatus(latest.status);
  const showStart = canStartHere && runs !== null && !latestActive && latest?.status !== "paid";

  if (!canStartHere && !loadError && !runs?.length) return null;

  function confirmStart() {
    setConfirmOpen(false);
    void start();
  }

  function retryStart() {
    clearStartError();
    setConfirmOpen(true);
  }

  const startedBy = (run: PaymentRun) =>
    run.started_by === profile?.id ? COPY.you : run.started_by_name;

  // Set apart from a run shown above it, so it reads as the next action.
  const actionSpacing = latest ? "mt-4 border-t border-border pt-4" : "mt-4";

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-surface p-6 shadow-sm"
    >
      <h3 id={headingId} className="text-lg font-semibold text-foreground">
        {COPY.heading}
      </h3>

      {loadError ? (
        <div role="alert" className="mt-4 flex flex-col items-start gap-3">
          <p className="text-sm text-overdue">{loadError}</p>
          <Button label={COPY.tryAgain} variant="secondary" onClick={reload} />
        </div>
      ) : runs === null ? (
        <p role="status" className="mt-4 text-sm text-foreground-muted">
          {COPY.loading}
        </p>
      ) : null}

      {/* Always mounted, so screen readers announce each new step and the end. */}
      <div aria-live="polite" className="not-empty:mt-4">
        {latest && (
          <LatestRun run={latest} startedBy={startedBy(latest)} pollFailing={pollFailing} />
        )}
      </div>

      {showStart &&
        (startError ? (
          <div className={actionSpacing}>
            <StartErrorPanel error={startError} onRetry={retryStart} />
          </div>
        ) : (
          <div
            className={`${actionSpacing} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6`}
          >
            <p className="text-sm text-foreground-muted">{COPY.explainer}</p>
            <Button
              label={starting ? COPY.starting : COPY.pay}
              onClick={() => setConfirmOpen(true)}
              disabled={starting}
              className="w-full shrink-0 sm:w-auto"
            />
          </div>
        ))}

      {earlier.length > 0 && <EarlierRuns runs={earlier} startedBy={startedBy} />}

      <ConfirmModal
        open={confirmOpen}
        title={COPY.confirmTitle}
        confirmLabel={COPY.confirmStart}
        onConfirm={confirmStart}
        onCancel={() => setConfirmOpen(false)}
      >
        {COPY.confirmBody}
      </ConfirmModal>
    </section>
  );
}

function StartErrorPanel({ error, onRetry }: { error: StartError; onRetry: () => void }) {
  const help =
    error.status === 409 ? COPY.conflictHelp : error.status === 422 ? COPY.setupHelp : null;

  return (
    <div role="alert" className="rounded-lg border border-overdue/40 bg-overdue-bg p-4">
      <div className="flex gap-3">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-overdue" />
        <div className="min-w-0 space-y-1 text-sm text-foreground">
          <p className="font-medium wrap-anywhere">{error.message}</p>
          {help && <p>{help}</p>}
        </div>
      </div>
      <div className="mt-3 pl-8">
        <Button label={COPY.tryAgain} variant="secondary" onClick={onRetry} />
      </div>
    </div>
  );
}

type Tone = "neutral" | "success" | "danger" | "warning";

const toneBox: Record<Tone, string> = {
  neutral: "border-border bg-surface-muted",
  success: "border-paid/40 bg-paid-bg",
  danger: "border-overdue/40 bg-overdue-bg",
  warning: "border-due-soon/40 bg-due-soon-bg",
};

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-4 ${toneBox[tone]}`}>
      <div className="flex gap-3">
        {icon}
        <div className="min-w-0 flex-1 space-y-1 text-sm text-foreground">
          <p className="text-base font-semibold wrap-anywhere">{title}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

const iconClass = "mt-0.5 size-5 shrink-0";

function LatestRun({
  run,
  startedBy,
  pollFailing,
}: {
  run: PaymentRun;
  startedBy: string | null;
  pollFailing: boolean;
}) {
  // One line on wider screens; on phones, started and finished stack.
  const meta = (
    <p className="text-sm text-foreground-muted">
      <span className="block sm:inline">
        {COPY.started(formatDateTime(run.created_at), startedBy)}
      </span>
      {run.finished_at && (
        <>
          <span aria-hidden className="hidden px-1.5 sm:inline">
            {COPY.separator}
          </span>
          <span className="block sm:inline">{COPY.finished(formatDateTime(run.finished_at))}</span>
        </>
      )}
    </p>
  );

  switch (run.status) {
    case "queued":
    case "running": {
      const queued = run.status === "queued";
      return (
        <div className="space-y-3">
          <Banner
            tone="neutral"
            icon={
              <LoaderCircle
                aria-hidden
                className={`${iconClass} animate-spin text-primary motion-reduce:animate-none`}
              />
            }
            title={queued ? COPY.queuedTitle : COPY.runningTitle}
          >
            <p className="text-foreground-muted">{queued ? COPY.queuedHint : COPY.runningHint}</p>
            {pollFailing && <p className="font-medium text-due-soon">{COPY.pollFailing}</p>}
          </Banner>
          {meta}
          <StepList steps={run.steps} />
        </div>
      );
    }
    case "paid":
      return (
        <div className="space-y-3">
          <Banner
            tone="success"
            icon={<CircleCheck aria-hidden className={`${iconClass} text-paid`} />}
            title={COPY.paidTitle}
          >
            <p>{COPY.paidHint}</p>
            <dl className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:gap-x-8">
              <Fact label={COPY.confirmationNumber}>
                {run.receipt?.confirmation_number ?? EMPTY_VALUE}
              </Fact>
              <Fact label={COPY.amount}>{formatMoney(run.receipt?.amount)}</Fact>
              <Fact label={COPY.paidOn}>{formatDay(run.receipt?.paid_on)}</Fact>
            </dl>
          </Banner>
          {meta}
          <CollapsedSteps steps={run.steps} />
        </div>
      );
    case "failed":
      return (
        <div className="space-y-3">
          <Banner
            tone="danger"
            icon={<CircleX aria-hidden className={`${iconClass} text-overdue`} />}
            title={COPY.failedTitle}
          >
            <p>{COPY.failedHint}</p>
            {run.receipt && <p>{COPY.portalReference(run.receipt.confirmation_number)}</p>}
          </Banner>
          {meta}
          <CollapsedSteps steps={run.steps} />
        </div>
      );
    case "flagged":
      return (
        <div className="space-y-3">
          <Banner
            tone="warning"
            icon={<TriangleAlert aria-hidden className={`${iconClass} text-due-soon`} />}
            title={COPY.flaggedTitle(run.flag_reason ?? EMPTY_VALUE)}
          >
            <p>{COPY.flaggedHint}</p>
          </Banner>
          {meta}
          <StepList steps={run.steps} />
        </div>
      );
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-foreground/75">{label}</dt>
      <dd className="font-semibold tabular-nums wrap-anywhere">{children}</dd>
    </div>
  );
}

function StepList({ steps }: { steps: PaymentRunStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-foreground-muted">{COPY.noSteps}</p>;
  }
  return (
    <ol aria-label={COPY.steps} className="space-y-2 text-sm">
      {steps.map((step) => (
        <li
          key={`${step.at}|${step.step}|${step.detail}`}
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3"
        >
          <time dateTime={step.at} className="text-foreground-muted tabular-nums">
            {formatTime(step.at)}
          </time>
          <span className="text-foreground wrap-anywhere">{step.detail}</span>
        </li>
      ))}
    </ol>
  );
}

function CollapsedSteps({ steps }: { steps: PaymentRunStep[] }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90" />
        {COPY.showSteps(steps.length)}
      </summary>
      <div className="pt-3">
        <StepList steps={steps} />
      </div>
    </details>
  );
}

function EarlierRuns({
  runs,
  startedBy,
}: {
  runs: PaymentRun[];
  startedBy: (run: PaymentRun) => string | null;
}) {
  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-sm font-medium text-foreground">{COPY.earlierRuns}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {runs.map((run) => (
          <li key={run.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-90"
                />
                {/* Badge above the times on phones, beside them from sm up. */}
                <span className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:gap-3">
                  <span className="shrink-0 sm:w-18">
                    <StatusBadge status={run.status} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-foreground">
                      {COPY.started(formatDateTime(run.created_at), startedBy(run))}
                    </span>
                    <span className="block text-foreground-muted">
                      {run.finished_at
                        ? COPY.finished(formatDateTime(run.finished_at))
                        : COPY.notFinished}
                    </span>
                  </span>
                </span>
              </summary>
              <div className="space-y-3 px-3 pt-1 pb-3 sm:pl-10">
                {run.flag_reason && (
                  <p className="text-sm font-medium text-foreground wrap-anywhere">
                    {COPY.flaggedTitle(run.flag_reason)}
                  </p>
                )}
                <StepList steps={run.steps} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

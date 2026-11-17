"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/http";
import { getPaymentRun, listPaymentRuns, startPaymentRun } from "@/lib/api/payment-runs";
import { isActiveRunStatus, type PaymentRun } from "@/types/payment-run";

export const POLL_INTERVAL_MS = 2000;
export const MAX_POLL_DELAY_MS = 30_000;

const LOAD_FAILED = "Unable to load payment runs.";
const START_FAILED = "Unable to start the payment run.";

// Wait before the next poll: every 2 s, doubling after each failed poll in a
// row (2, 4, 8, 16 s) up to 30 s, and back to 2 s after a success.
export function pollDelay(failuresInARow: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** failuresInARow, MAX_POLL_DELAY_MS);
}

export type StartError = {
  message: string;
  // The HTTP status, or null when the request never got an answer.
  status: number | null;
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The bill's payment runs, newest first, kept live: while the newest run is
 * queued or running it is re-read every 2 s until it ends. `onPaid` is called
 * once when a run this component is watching ends paid.
 */
export function usePaymentRuns(billId: string, onPaid?: () => void) {
  // null until the first load answers.
  const [runs, setRuns] = useState<PaymentRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The last poll failed; the shown run may be out of date.
  const [pollFailing, setPollFailing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<StartError | null>(null);

  // Read at call time, so a new `onPaid` from each parent render never
  // restarts polling.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `loadAttempt` re-runs the load on retry
  useEffect(() => {
    let cancelled = false;

    listPaymentRuns(billId)
      .then((result) => {
        if (cancelled) return;
        setRuns(result);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(messageOf(error, LOAD_FAILED));
      });

    return () => {
      cancelled = true;
    };
  }, [billId, loadAttempt]);

  const latest = runs?.[0] ?? null;
  const activeRunId = latest && isActiveRunStatus(latest.status) ? latest.id : null;

  // One request at a time: the next poll is scheduled only after the last one
  // answered. Unmounting, or the run ending, clears the timer and aborts any
  // request still in flight.
  useEffect(() => {
    if (!activeRunId) return;
    const runId = activeRunId;
    // A run is under way now, so an error from an earlier start (a 409 for
    // this very run) is out of date; it must not come back when the run ends.
    setStartError(null);

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failuresInARow = 0;

    const schedule = () => {
      timer = setTimeout(poll, pollDelay(failuresInARow));
    };

    async function poll() {
      try {
        const run = await getPaymentRun(runId, controller.signal);
        if (controller.signal.aborted) return;
        failuresInARow = 0;
        setPollFailing(false);
        setRuns((current) => current?.map((r) => (r.id === run.id ? run : r)) ?? [run]);
        if (isActiveRunStatus(run.status)) {
          schedule();
        } else if (run.status === "paid") {
          onPaidRef.current?.();
        }
      } catch {
        if (controller.signal.aborted) return;
        failuresInARow += 1;
        setPollFailing(true);
        schedule();
      }
    }

    schedule();

    return () => {
      clearTimeout(timer);
      controller.abort();
      setPollFailing(false);
    };
  }, [activeRunId]);

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const run = await startPaymentRun(billId);
      setRuns((current) => [run, ...(current ?? [])]);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : null;
      setStartError({ message: messageOf(error, START_FAILED), status });
      // Someone else may have started a run: show it, and follow it if active.
      if (status === 409) setLoadAttempt((n) => n + 1);
    } finally {
      setStarting(false);
    }
  }

  function reload() {
    setLoadError(null);
    setLoadAttempt((n) => n + 1);
  }

  return {
    runs,
    loadError,
    reload,
    pollFailing,
    start,
    starting,
    startError,
    clearStartError: () => setStartError(null),
  };
}

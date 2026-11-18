"use client";

import { useEffect, useState } from "react";
import Button from "@/components/Button";
import { getBillHistory } from "@/lib/api/audit";
import type { BillHistoryEvent } from "@/types/audit";
import { actorName, formatWhen } from "./format";

const COPY = {
  title: "Bill history",
  loading: "Loading bill history...",
  empty: "No history for this bill yet.",
  loadFailed: "Unable to load bill history.",
  tryAgain: "Try again",
};

export function BillHistory({ billId }: { billId: string }) {
  const [events, setEvents] = useState<BillHistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on Try again.
  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);

    getBillHistory(billId)
      .then((history) => {
        if (!cancelled) setEvents(history.events);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : COPY.loadFailed);
      });

    return () => {
      cancelled = true;
    };
  }, [billId, attempt]);

  return (
    <section
      aria-labelledby="bill-history-title"
      className="rounded-lg border border-border bg-surface p-6"
    >
      <h2
        id="bill-history-title"
        className="mb-6 inline-block rounded bg-surface-muted px-3 py-1 text-xl font-medium text-foreground"
      >
        {COPY.title}
      </h2>

      {error ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-overdue">{error}</p>
          <Button
            label={COPY.tryAgain}
            variant="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          />
        </div>
      ) : events === null ? (
        <p role="status" className="text-foreground-muted">
          {COPY.loading}
        </p>
      ) : events.length === 0 ? (
        <p className="text-foreground-muted">{COPY.empty}</p>
      ) : (
        <ol className="space-y-4 border-l border-border pl-5">
          {events.map((event) => (
            <li
              key={`${event.change_id ?? event.run_id ?? event.at}-${event.kind}`}
              className="relative"
            >
              <span
                aria-hidden={true}
                className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-primary"
              />
              <p className="text-xs text-foreground-muted">
                <time dateTime={event.at}>{formatWhen(event.at)}</time>
                {" · "}
                {actorName(event.actor)}
              </p>
              <p className="font-medium text-foreground">{event.summary}</p>
              {event.detail && (
                <p className="break-words text-sm text-foreground-muted">{event.detail}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

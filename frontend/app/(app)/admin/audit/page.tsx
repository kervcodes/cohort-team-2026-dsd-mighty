"use client";

import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { listAuditChanges } from "@/lib/api/audit";
import { listUsers } from "@/lib/api/users";
import { type AuditChange, type AuditTable, auditTables } from "@/types/audit";
import type { ApiProfile } from "@/types/user";
import { BillHistory } from "./BillHistory";
import { ChangesTable } from "./ChangesTable";
import { shortId, TABLE_LABELS } from "./format";

const COPY = {
  sectionTitle: "Changes",
  pageTitle: "Audit log",
  loading: "Loading changes...",
  empty: "No changes match these filters.",
  loadFailed: "Unable to load changes.",
  tryAgain: "Try again",
  loadMore: "Load more",
  loadingMore: "Loading...",
  table: "Table",
  user: "User",
  from: "From",
  to: "To",
  allTables: "All",
  allUsers: "All users",
  unknownUser: (id: string) => `User ${shortId(id)}`,
  bill: (id: string) => `Bill ${shortId(id)}`,
  clearBill: "Clear bill filter",
  auth_loading: "loading permissions...",
  auth_error: "Your role does not have access",
};

const PATH = "/admin/audit";

type Filters = {
  table: AuditTable | "";
  actorId: string;
  billId: string;
  from: string;
  to: string;
};

function isAuditTable(value: string | null): value is AuditTable {
  return auditTables.some((table) => table === value);
}

const fieldClass =
  "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "mb-1 block text-sm font-medium text-foreground";

function AuditPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const canView = !authLoading && profile?.role === "admin" && profile.status === "active";

  // The URL is the source of truth for the filters, so a link opens a filtered view.
  const tableParam = searchParams.get("table");
  const filters: Filters = {
    table: isAuditTable(tableParam) ? tableParam : "",
    actorId: searchParams.get("actor_id") ?? "",
    billId: searchParams.get("bill_id") ?? "",
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  };
  const { table, actorId, billId, from, to } = filters;

  const [users, setUsers] = useState<ApiProfile[]>([]);
  const [changes, setChanges] = useState<AuditChange[] | null>(null);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Only the latest request may set state, so a slow answer for earlier
  // filters never replaces the current list.
  const latestRequest = useRef(0);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    listUsers()
      .then((result) => {
        if (!cancelled) setUsers(result);
      })
      .catch(() => {
        // The filter keeps working with "All users" only.
      });

    return () => {
      cancelled = true;
    };
  }, [canView]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on Try again.
  useEffect(() => {
    if (!canView) return;
    const request = ++latestRequest.current;

    setChanges(null);
    setNextBeforeId(null);
    setError(null);
    setLoadMoreError(null);
    setLoadingMore(false);

    listAuditChanges({
      table: table || undefined,
      actor_id: actorId || undefined,
      bill_id: billId || undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .then((page) => {
        if (request !== latestRequest.current) return;
        setChanges(page.items);
        setNextBeforeId(page.next_before_id);
      })
      .catch((err: unknown) => {
        if (request !== latestRequest.current) return;
        setError(err instanceof Error ? err.message : COPY.loadFailed);
      });
  }, [canView, table, actorId, billId, from, to, attempt]);

  function loadMore() {
    if (nextBeforeId === null || loadingMore) return;
    const request = latestRequest.current;

    setLoadingMore(true);
    setLoadMoreError(null);

    listAuditChanges({
      table: table || undefined,
      actor_id: actorId || undefined,
      bill_id: billId || undefined,
      from: from || undefined,
      to: to || undefined,
      before_id: nextBeforeId,
    })
      .then((page) => {
        if (request !== latestRequest.current) return;
        setChanges((current) => [...(current ?? []), ...page.items]);
        setNextBeforeId(page.next_before_id);
      })
      .catch((err: unknown) => {
        if (request !== latestRequest.current) return;
        setLoadMoreError(err instanceof Error ? err.message : COPY.loadFailed);
      })
      .finally(() => {
        if (request === latestRequest.current) setLoadingMore(false);
      });
  }

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const qs = next.toString();
      router.replace(qs ? `${PATH}?${qs}` : PATH, { scroll: false });
    },
    [router, searchParams],
  );

  if (authLoading) return <p>{COPY.auth_loading}</p>;
  if (!canView) return <p>{COPY.auth_error}</p>;

  const actorKnown = users.some((user) => user.user_id === actorId);

  let body: React.ReactNode;
  if (error) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-overdue">{error}</p>
        <Button
          label={COPY.tryAgain}
          variant="secondary"
          onClick={() => setAttempt((n) => n + 1)}
        />
      </div>
    );
  } else if (changes === null) {
    body = (
      <p role="status" className="px-6 py-12 text-center text-foreground-muted">
        {COPY.loading}
      </p>
    );
  } else if (changes.length === 0) {
    body = <p className="px-6 py-12 text-center text-foreground-muted">{COPY.empty}</p>;
  } else {
    body = (
      <>
        <ChangesTable changes={changes} />
        {(nextBeforeId !== null || loadMoreError) && (
          <div className="flex flex-col items-center gap-3 border-t border-border px-6 py-4">
            {loadMoreError && (
              <p role="alert" className="text-sm text-overdue">
                {loadMoreError}
              </p>
            )}
            {nextBeforeId !== null && (
              <Button
                label={loadingMore ? COPY.loadingMore : COPY.loadMore}
                variant="secondary"
                disabled={loadingMore}
                onClick={loadMore}
              />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-6 inline-block rounded bg-surface-muted px-3 py-1 text-xl font-medium text-foreground">
          {COPY.pageTitle}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <label htmlFor="audit-table" className={labelClass}>
              {COPY.table}
            </label>
            <select
              id="audit-table"
              className={fieldClass}
              value={table}
              onChange={(event) => setParam("table", event.target.value)}
            >
              <option value="">{COPY.allTables}</option>
              {auditTables.map((name) => (
                <option key={name} value={name}>
                  {TABLE_LABELS[name]}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="audit-user" className={labelClass}>
              {COPY.user}
            </label>
            <select
              id="audit-user"
              className={fieldClass}
              value={actorId}
              onChange={(event) => setParam("actor_id", event.target.value)}
            >
              <option value="">{COPY.allUsers}</option>
              {actorId && !actorKnown && (
                <option value={actorId}>{COPY.unknownUser(actorId)}</option>
              )}
              {users.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="audit-from" className={labelClass}>
              {COPY.from}
            </label>
            <input
              id="audit-from"
              type="date"
              className={fieldClass}
              value={from}
              max={to || undefined}
              onChange={(event) => setParam("from", event.target.value)}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="audit-to" className={labelClass}>
              {COPY.to}
            </label>
            <input
              id="audit-to"
              type="date"
              className={fieldClass}
              value={to}
              min={from || undefined}
              onChange={(event) => setParam("to", event.target.value)}
            />
          </div>
        </div>

        {billId && (
          <p className="mt-4 inline-flex max-w-full items-center gap-1 rounded-full bg-accent py-1 pr-1 pl-3 text-sm font-medium text-accent-foreground">
            <span className="truncate" title={billId}>
              {COPY.bill(billId)}
            </span>
            <button
              type="button"
              aria-label={COPY.clearBill}
              onClick={() => setParam("bill_id", "")}
              className="rounded-full p-1 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden={true} className="h-3.5 w-3.5" />
            </button>
          </p>
        )}
      </section>

      {billId && <BillHistory billId={billId} />}

      <section
        aria-label={COPY.sectionTitle}
        className="rounded-xl border border-border bg-surface shadow-sm"
      >
        {body}
      </section>
    </div>
  );
}

export default AuditPage;

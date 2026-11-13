"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { getApprovals } from "@/lib/api/approvals";
import { getBill } from "@/lib/api/bills";
import type { Approval } from "@/types/approval";
import type { Bill } from "@/types/bill";

type ApprovalQueueItem = {
  approval: Approval;
  bill: Bill;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(date: string | null) {
  if (!date) return "—";

  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ApprovalsPage() {
  const { profile, loading: accountLoading } = useAuth();

  const canReview =
    !accountLoading &&
    profile?.status === "active" &&
    (profile.role === "approver" || profile.role === "admin");

  const [items, setItems] = useState<ApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canReview) return;

    let cancelled = false;

    async function loadApprovals() {
      try {
        const approvals = await getApprovals({
          status: "pending",
          limit: 100,
        });

        const results = await Promise.all(
          approvals.map(async (approval) => ({
            approval,
            bill: await getBill(approval.bill_id),
          })),
        );

        if (!cancelled) {
          setItems(results);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load pending approvals.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadApprovals();

    return () => {
      cancelled = true;
    };
  }, [canReview]);

  if (accountLoading) {
    return (
      <main className="mx-auto max-w-6xl pt-16">
        <p role="status" className="text-sm text-foreground-muted">
          Loading account...
        </p>
      </main>
    );
  }

  if (!canReview) {
    return (
      <main className="mx-auto max-w-6xl space-y-4 pt-16">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p role="alert" className="text-sm text-red-600">
          You do not have permission to view approvals.
        </p>
        <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 pt-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Approval Queue</h1>
        <p className="mt-1 text-sm text-foreground-muted">Review invoices awaiting approval.</p>
      </div>

      {loading && (
        <p role="status" className="text-sm text-foreground-muted">
          Loading pending approvals...
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <section className="rounded-xl border border-border bg-surface p-8 text-center">
          <h2 className="font-semibold text-foreground">No pending approvals</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            You're all caught up. New invoices awaiting review will appear here.
          </p>
        </section>
      )}

      {!loading && !error && items.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-secondary text-foreground-muted">
                <tr>
                  <th className="px-6 py-4 font-medium">Invoice</th>
                  <th className="px-6 py-4 font-medium">Vendor</th>
                  <th className="px-6 py-4 font-medium">Property</th>
                  <th className="px-6 py-4 font-medium">Amount</th>
                  <th className="px-6 py-4 font-medium">Submitted</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {items.map(({ approval, bill }) => {
                  const requiresAdmin = Number(bill.amount) > 5000 && profile.role !== "admin";

                  return (
                    <tr key={approval.id} className="hover:bg-surface-secondary">
                      <td className="px-6 py-4 font-medium">
                        <Link
                          href={`/invoices/${bill.id}`}
                          className="text-primary hover:underline"
                        >
                          {bill.invoice_number}
                        </Link>
                      </td>

                      <td className="px-6 py-4">{bill.vendor_name_raw ?? "—"}</td>

                      <td className="px-6 py-4">{bill.property_address ?? "—"}</td>

                      <td className="px-6 py-4 tabular-nums">
                        {currency.format(Number(bill.amount))}
                      </td>

                      <td className="px-6 py-4">{formatDate(approval.requested_at)}</td>

                      <td className="px-6 py-4">
                        {requiresAdmin ? (
                          <span className="text-xs font-medium text-amber-700">
                            Admin review required
                          </span>
                        ) : (
                          <StatusBadge status={bill.status} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { InvoiceTable } from "@/components/Invoice-table/invoice-table";
import { getDashboardBills } from "@/lib/api/bills";
import { toInvoice } from "@/lib/invoices";
import type { DashboardBill } from "@/types/bill";

export default function DraftsPage() {
  const { profile, loading: accountLoading } = useAuth();

  //ensure profile is not inactive
  const canLoad = !accountLoading && !!profile && profile.status !== "inactive";

  const [bills, setBills] = useState<DashboardBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canLoad) return;

    let cancelled = false;

    async function loadDrafts() {
      try {
        const result = await getDashboardBills();

        if (!cancelled) {
          setBills(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load saved drafts.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDrafts();

    return () => {
      cancelled = true;
    };
  }, [canLoad]);

  const drafts = bills.filter((bill) => bill.status === "draft").map(toInvoice);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Saved Drafts</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Continue working on invoices you haven't submitted yet.
          </p>
        </div>

        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          New Invoice
        </Link>
      </div>

      {loading && (
        <p role="status" className="text-sm text-foreground-muted">
          Loading drafts...
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && (
        <InvoiceTable
          invoices={drafts}
          title="Saved Drafts"
          emptyMessage="No saved drafts yet. Create an invoice and save it as a draft."
        />
      )}
    </div>
  );
}

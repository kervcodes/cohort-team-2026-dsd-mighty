"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { InvoiceTable } from "@/components/Invoice-table/invoice-table";
import { StatCard } from "@/components/Stat-card/stat-card";
import { type DashboardBill, getDashboardBills } from "@/lib/api/bills";
import type { Invoice } from "@/types/invoice";

function toInvoice(bill: DashboardBill): Invoice {
  return {
    id: bill.bill_id,
    invoiceNumber: bill.invoice_number,
    property: bill.property_address || "Not assigned",
    company: bill.vendor_name_raw || "Not specified",
    dueDate: bill.due_date,
    vendor: bill.vendor_name_raw || "Not specified",
    amount: bill.amount,
    status: bill.status,
  };
}

function toISODate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

type DateRange = { start: string; end: string };

// Today through the coming Sunday, as local YYYY-MM-DD strings.
function thisWeek(today: Date): DateRange {
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + ((7 - today.getDay()) % 7));
  return { start: toISODate(today), end: toISODate(endOfWeek) };
}

export default function DashboardPage() {
  const { profile, loading: accountLoading } = useAuth();
  // Wait for /me: an inactive user gets the waiting screen instead, and their
  // bill request would only be refused.
  const canLoad = !accountLoading && profile?.status !== "inactive";
  const [bills, setBills] = useState<DashboardBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Read the clock in an effect, not during render: with Cache Components a
  // render-time `new Date()` would be frozen into the prerendered page.
  const [week, setWeek] = useState<DateRange | null>(null);

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;

    async function loadInvoices() {
      try {
        const result = await getDashboardBills();

        if (!cancelled) {
          setBills(result);
          setWeek(thisWeek(new Date()));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load invoices.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInvoices();

    return () => {
      cancelled = true;
    };
  }, [canLoad]);

  const invoices = bills.map(toInvoice);

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  const drafts = bills.filter((bill) => bill.status === "draft");

  const outstanding = bills.filter((bill) =>
    ["pending_approval", "approved"].includes(bill.status),
  );

  const outstandingTotal = outstanding.reduce((sum, bill) => sum + (bill.amount ?? 0), 0);

  const dueThisWeek = bills.filter(
    (bill) =>
      week !== null &&
      bill.due_date !== null &&
      bill.due_date >= week.start &&
      bill.due_date <= week.end &&
      !["paid", "rejected", "failed"].includes(bill.status),
  );

  const dueThisWeekTotal = dueThisWeek.reduce((sum, bill) => sum + (bill.amount ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Bill &amp; Invoice
        </h1>

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
          Loading invoices...
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Outstanding"
              value={currency.format(outstandingTotal)}
              hint={`${outstanding.length} invoices`}
            />

            <StatCard
              label="Due this week"
              value={currency.format(dueThisWeekTotal)}
              hint={`${dueThisWeek.length} invoices`}
            />

            <StatCard label="Saved drafts" value={String(drafts.length)} hint="Not yet submitted" />
          </div>

          <InvoiceTable invoices={invoices} />
        </>
      )}
    </div>
  );
}

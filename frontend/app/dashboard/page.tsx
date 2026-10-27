"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { InvoiceTable } from "@/components/Invoice-table/invoice-table";
import { StatCard } from "@/components/Stat-card/stat-card";
import type { Invoice } from "@/types/invoice";

//examples
const invoices: Invoice[] = [
  {
    id: "INV-1013",
    property: "Oak Terrace",
    company: "Northgate LLC",
    dueDate: "2026-10-28",
    vendor: "Rapid Plumbing & Rooter",
    amount: 1180.5,
    status: "pending",
  },
  {
    id: "INV-1011",
    property: "Maple Court",
    company: "Westside Holdings",
    dueDate: "2026-10-20",
    vendor: "ProGuard Security",
    amount: 780.0,
    status: "overdue",
  },
  {
    id: "INV-1010",
    property: "Harbor View",
    company: "Bluebird Realty",
    dueDate: "2026-10-15",
    vendor: "LADWP",
    amount: 1102.64,
    status: "paid",
  },
];

const placeholderStats = {
  outstanding: { value: "$1,960.50", count: 2 },
  dueThisWeek: { value: "$1,180.50", count: 4 },
  paidThisMonth: { value: "$1,102.64", count: 3 },
};

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Bill &amp; Invoice
        </h1>

        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" />
          New Invoice
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Outstanding"
          value={placeholderStats.outstanding.value}
          hint={`${placeholderStats.outstanding.count} invoices`}
        />
        <StatCard
          label="Due this week"
          value={placeholderStats.dueThisWeek.value}
          hint={`${placeholderStats.dueThisWeek.count} invoices`}
        />
        <StatCard
          label="Paid this month"
          value={placeholderStats.paidThisMonth.value}
          hint={`${placeholderStats.dueThisWeek.value} invoices`}
        />
      </div>

      <InvoiceTable invoices={invoices} />
    </div>
  );
}

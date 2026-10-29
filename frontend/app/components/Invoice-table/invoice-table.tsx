"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import type { Invoice } from "@/types/invoice";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const columns = ["Invoice ID", "Property", "Company", "Due Date", "Vendor", "Amount", "Status"];

export function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const [_page, _setPage] = useState<number>(1);

  const rows = invoices.slice(0, 10);

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border px-6 py-5">
        <h2 className="text-xl font-semibold text-foreground">Invoice History</h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-200 text-left text-sm">
          <thead>
            <tr className="border-b border-border text-foreground-muted">
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className={`px-6 py-3 font-medium ${col === "Amount" ? "text-right" : ""}`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-12 text-center text-foreground-muted"
                >
                  No invoices yet. Click "New Invoice" to add one.
                </td>
              </tr>
            ) : (
              rows.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="text-foreground transition-colors hover:bg-surface-muted"
                >
                  <td className="px-6 py-4 font-mono text-xs">{invoice.id}</td>
                  <td className="px-6 py-4">{invoice.property}</td>
                  <td className="px-6 py-4">{invoice.company}</td>
                  <td className="px-6 py-4 tabular-nums">{formatDate(invoice.dueDate)}</td>
                  <td className="px-6 py-4">{invoice.vendor}</td>
                  <td className="px-6 py-4 text-right font-medium tabular-nums">
                    {currency.format(invoice.amount)}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-between border-t border-border px-6 py-4">
        <p className="text-sm text-foreground-muted tabular-nums">Page 1 of 10</p>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}

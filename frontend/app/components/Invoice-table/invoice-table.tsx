"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import Button from "@/components/ui/button";
import { dashboard } from "@/content";
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

const { table } = dashboard;

const columns = [
  { key: "columnId", label: table.columnId },
  { key: "columnProperty", label: table.columnProperty },
  { key: "columnCompany", label: table.columnCompany },
  { key: "columnDueDate", label: table.columnDueDate },
  { key: "columnVendor", label: table.columnVendor },
  { key: "columnAmount", label: table.columnAmount },
  { key: "columnStatus", label: table.columnStatus },
];

export function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const [_page, _setPage] = useState<number>(1);

  const rows = invoices.slice(0, 10);

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border px-6 py-5">
        <h2 data-content="dashboard.table.title" className="text-xl font-semibold text-foreground">
          {table.title}
        </h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-200 text-left text-sm">
          <thead>
            <tr className="border-b border-border text-foreground-muted">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  data-content={`dashboard.table.${col.key}`}
                  className={`px-6 py-3 font-medium ${col.key === "columnAmount" ? "text-right" : ""}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  data-content="dashboard.table.empty"
                  colSpan={columns.length}
                  className="px-6 py-12 text-center text-foreground-muted"
                >
                  {table.empty}
                </td>
              </tr>
            ) : (
              rows.map((invoice) => (
                <tr
                  key={invoice.id}
                  data-content-skip="invoice row derived from API data"
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
        <p
          data-content="dashboard.table.pagination"
          className="text-sm text-foreground-muted tabular-nums"
        >
          {table.pagination}
        </p>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            label={table.previous}
            data-content="dashboard.table.previous"
          />
          <Button
            variant="secondary"
            size="sm"
            label={table.next}
            data-content="dashboard.table.next"
          />
        </div>
      </footer>
    </section>
  );
}

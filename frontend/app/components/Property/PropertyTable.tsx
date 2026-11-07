"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import type { Property } from "@/types/property";
import type { UserRole } from "@/types/user";

function formatDate(datetime: string) {
  return new Date(datetime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const columns = [
  "Property ID",
  "Property Name",
  "Street",
  "City",
  "State",
  "Zip Code",
  "Created At",
  "Status",
];

export function PropertyTable({
  properties,
  userRole,
}: {
  properties: Property[];
  userRole: UserRole;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(properties.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const rows = properties.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border px-6 py-5">
        <h2 className="text-xl font-semibold text-foreground">All Properties</h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-200 text-left text-sm">
          <thead>
            <tr className="border-b border-border text-foreground-muted">
              {columns.map((col) => (
                <th key={col} scope="col" className="px-6 py-3 font-medium">
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
                  {userRole === "admin"
                    ? `No properties yet. Click "Add Property" to add one.`
                    : "Admin needs to add a Property"}
                </td>
              </tr>
            ) : (
              rows.map((property) => (
                <tr
                  key={property.property_id}
                  className="text-foreground transition-colors hover:bg-surface-muted"
                >
                  <td className="px-6 py-4 font-mono text-xs">
                    {property.property_id.slice(0, 8)}
                  </td>
                  <td className="px-6 py-4">{property.property_name}</td>
                  <td className="px-6 py-4">{property.street}</td>

                  <td className="px-6 py-4">{property.city}</td>
                  <td className="px-6 py-4">{property.state}</td>
                  <td className="px-6 py-4">{property.zip_code}</td>
                  <td className="px-6 py-4 tabular-nums">{formatDate(property.created_at)}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={property.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-between border-t border-border px-6 py-4">
        <p className="text-sm text-foreground-muted tabular-nums">
          Page {currentPage} of {totalPages}
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            type="button"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
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

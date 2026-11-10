"use client";

import { type ReactNode, useState } from "react";
import Button from "@/components/Button";

const COPY = {
  loading: "Loading...",
  tryAgain: "Try again",
  previous: "Previous",
  next: "Next",
  page: (current: number, total: number) => `Page ${current} of ${total}`,
};

export type DataTableColumn<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
};

export type DataTableProps<T> = {
  // Accessible name of the table (a visually hidden caption).
  label: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  // Shown instead of the rows when set, with a retry button if `onRetry` is given.
  error?: string | null;
  onRetry?: () => void;
  pageSize?: number;
};

const pageButton =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface";

/**
 * A table of `rows`, one column per entry in `columns`, with loading, error
 * and empty states and client-side pagination. Columns say how to render a
 * row, so the table knows nothing about the data.
 *
 * Example:
 *   <DataTable
 *     label="Vendors"
 *     columns={[{ header: "Name", cell: (v) => v.name }]}
 *     rows={vendors}
 *     getRowKey={(v) => v.id}
 *     loading={loading}
 *     error={error}
 *     onRetry={reload}
 *     emptyMessage="No vendors yet."
 *   />
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  getRowKey,
  emptyMessage,
  loading = false,
  loadingMessage = COPY.loading,
  error = null,
  onRetry,
  pageSize = 10,
}: DataTableProps<T>) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const alignClass = (column: DataTableColumn<T>) =>
    column.align === "right" ? "text-right" : "text-left";

  // Loading, error and empty each replace the rows with one full-width message.
  let message: ReactNode = null;
  if (loading) {
    message = <p role="status">{loadingMessage}</p>;
  } else if (error) {
    message = (
      <div role="alert" className="flex flex-col items-center gap-3">
        <p className="text-overdue">{error}</p>
        {onRetry && <Button label={COPY.tryAgain} variant="secondary" onClick={onRetry} />}
      </div>
    );
  } else if (rows.length === 0) {
    message = <p>{emptyMessage}</p>;
  }

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-200 text-sm" aria-busy={loading}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-border text-foreground-muted">
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={`px-6 py-3 font-medium ${alignClass(column)}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {message ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-12 text-center text-foreground-muted"
                >
                  {message}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className="text-foreground transition-colors hover:bg-surface-muted"
                >
                  {columns.map((column) => (
                    <td key={column.header} className={`px-6 py-4 ${alignClass(column)}`}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!message && totalPages > 1 && (
        <footer className="flex items-center justify-between border-t border-border px-6 py-4">
          <p className="text-sm text-foreground-muted tabular-nums">
            {COPY.page(currentPage, totalPages)}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className={pageButton}
            >
              {COPY.previous}
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className={pageButton}
            >
              {COPY.next}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

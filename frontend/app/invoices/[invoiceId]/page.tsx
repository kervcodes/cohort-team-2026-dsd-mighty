"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { getBill, getBillDocument } from "@/lib/api/bills";
import type { Bill } from "@/types/bill";

function formatDate(date: string | null) {
  if (!date) return "—";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = params.id;

  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBill() {
      try {
        const result = await getBill(invoiceId);

        if (cancelled) return;

        setBill(result);
        setError(null);

        if (result.document_path) {
          setDocumentLoading(true);

          try {
            const document = await getBillDocument(invoiceId);

            if (!cancelled) {
              setDocumentUrl(document.document_url);
              setDocumentError(null);
            }
          } catch (err) {
            if (!cancelled) {
              setDocumentError(err instanceof Error ? err.message : "Unable to load invoice PDF.");
            }
          } finally {
            if (!cancelled) {
              setDocumentLoading(false);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load invoice.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBill();

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl pt-16">
        <p role="status" className="text-sm text-foreground-muted">
          Loading invoice...
        </p>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 pt-16">
        <p role="alert" className="text-sm text-red-600">
          {error ?? "Invoice not found."}
        </p>

        <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 pt-16">
      <Link href="/dashboard" className="text-sm text-foreground-muted hover:text-foreground">
        ← Back to dashboard
      </Link>

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-foreground-muted">Invoice</p>
            <h1 className="text-2xl font-semibold text-foreground">{bill.invoice_number}</h1>
          </div>

          <StatusBadge status={bill.status} />
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-sm text-foreground-muted">Vendor</p>
            <p className="font-medium">{bill.vendor_name_raw ?? "—"}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Property</p>
            <p className="font-medium">{bill.property_address ?? "—"}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Account number</p>
            <p className="font-medium">{bill.account_number_raw}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Invoice date</p>
            <p className="font-medium">{formatDate(bill.invoice_date)}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Due date</p>
            <p className="font-medium">{formatDate(bill.due_date)}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Submitted by</p>
            <p className="font-medium">{bill.submitted_by.full_name}</p>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <p className="text-sm text-foreground-muted">Invoice amount</p>
          <p className="text-3xl font-semibold tabular-nums">
            {currency.format(Number(bill.amount))}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Description</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          {bill.description || "No description provided."}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Invoice Document</h2>

        {documentLoading && (
          <p role="status" className="mt-4 text-sm text-foreground-muted">
            Loading PDF...
          </p>
        )}

        {documentError && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {documentError}
          </p>
        )}

        {!bill.document_path && (
          <p className="mt-4 text-sm text-foreground-muted">No PDF attached to this invoice.</p>
        )}

        {documentUrl && (
          <iframe
            src={documentUrl}
            title={`Invoice ${bill.invoice_number}`}
            className="mt-4 h-[700px] w-full rounded-lg border border-border"
          />
        )}
      </section>
    </main>
  );
}

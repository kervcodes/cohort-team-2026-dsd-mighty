"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { DataTable, type DataTableColumn } from "@/components/DataTable/DataTable";
import PageHeader from "@/components/PageHeader/PageHeader";
import { listVendors, paymentMethodLabels, type Vendor } from "@/lib/api/vendors";

const COPY = {
  title: "Vendors",
  addVendor: "Add Vendor",
  loading: "Loading vendors...",
  empty: "No vendors yet.",
  emptyForAdmin: 'No vendors yet. Click "Add Vendor" to add one.',
  loadFailed: "Unable to load vendors.",
  notSet: "—",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const columns: DataTableColumn<Vendor>[] = [
  { header: "Name", cell: (vendor) => vendor.name },
  { header: "Email", cell: (vendor) => vendor.contact_email ?? COPY.notSet },
  { header: "Phone", cell: (vendor) => vendor.contact_phone ?? COPY.notSet },
  {
    header: "Default payment method",
    cell: (vendor) =>
      vendor.default_payment_method
        ? paymentMethodLabels[vendor.default_payment_method]
        : COPY.notSet,
  },
  { header: "Created", cell: (vendor) => formatDate(vendor.created_at) },
];

export default function VendorsPage() {
  const { profile, loading: authLoading } = useAuth();
  // Hidden until the profile is known, so it never flashes for other roles.
  // The backend refuses POST /vendors from anyone but an admin.
  const isAdmin = !authLoading && profile?.role === "admin";

  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Runs on every visit, including the return from /vendors/new: Next.js keeps
  // this page's state across navigations, but re-runs its effects. The list
  // from the last visit stays on screen while the fresh one loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry
  useEffect(() => {
    let cancelled = false;

    listVendors()
      .then((result) => {
        if (cancelled) return;
        setVendors(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : COPY.loadFailed);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setError(null);
    setAttempt((n) => n + 1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      {isAdmin ? (
        <PageHeader title={COPY.title} hasCta ctaText={COPY.addVendor} ctaLink="/vendors/new" />
      ) : (
        <PageHeader title={COPY.title} hasCta={false} />
      )}

      <DataTable
        label={COPY.title}
        columns={columns}
        rows={vendors ?? []}
        getRowKey={(vendor) => vendor.id}
        loading={vendors === null && error === null}
        loadingMessage={COPY.loading}
        error={error}
        onRetry={retry}
        emptyMessage={isAdmin ? COPY.emptyForAdmin : COPY.empty}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { linkButton } from "@/components/Property/PropertyForm";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { getProperty, type PropertyRead, updateProperty } from "@/lib/api/properties";
import { lookUpVendorAccounts } from "@/lib/api/vendor-account-lookup";

const COPY = {
  loading: "Loading property...",
  loadFailed: "Unable to load the property.",
  tryAgain: "Try again",
  address: "Address",
  status: "Status",
  createdAt: "Added",
  edit: "Edit",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
  saving: "Saving...",
  cancel: "Cancel",
  confirmDeactivate: "Deactivate property",
  deactivateQuestion: (name: string) => `Deactivate ${name}?`,
  deactivateEffect:
    "New bills will no longer be matched to it by address, and it won't be offered for new vendor accounts. Bills and accounts that already use it keep it.",
  accountsUsingIt: (count: number) =>
    count === 1
      ? "1 active vendor account uses this property."
      : `${count} active vendor accounts use this property.`,
  deactivated: "Property deactivated.",
  reactivated: "Property reactivated.",
  statusFailed: "Unable to change the property's status.",
};

function formatDate(datetime: string) {
  return new Date(datetime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// While the property loads; also the page's Suspense fallback.
export function PropertyLoading() {
  return (
    <p role="status" className="mt-6 text-foreground-muted">
      {COPY.loading}
    </p>
  );
}

/**
 * The property at /properties/:propertyId. Admins edit it and deactivate or
 * reactivate it; everyone else reads. There is no delete: bills and vendor
 * accounts keep their property. Reads `useParams`, so the page renders it
 * inside Suspense.
 */
export default function PropertyDetail() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { profile, loading: authLoading } = useAuth();
  // Hidden until the profile is known, so it never flashes for other roles.
  // The backend refuses changes from anyone but an admin.
  const isAdmin = !authLoading && profile?.role === "admin";

  const [property, setProperty] = useState<PropertyRead | null>(null);
  // Active vendor accounts at this property; null while unknown. Only the
  // deactivate warning uses it, so failing to load it never blocks the page.
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry
  useEffect(() => {
    let cancelled = false;

    getProperty(propertyId)
      .then((loaded) => {
        if (cancelled) return;
        setProperty(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : COPY.loadFailed);
      });

    lookUpVendorAccounts()
      .then((accounts) => {
        if (cancelled) return;
        setAccountCount(accounts.filter((account) => account.property_id === propertyId).length);
      })
      .catch(() => {
        if (!cancelled) setAccountCount(null);
      });

    return () => {
      cancelled = true;
    };
  }, [propertyId, attempt]);

  function retry() {
    setError(null);
    setAttempt((n) => n + 1);
  }

  async function changeStatus(status: PropertyRead["status"]) {
    setSaving(true);
    setNotice(null);
    setStatusError(null);
    try {
      setProperty(await updateProperty(propertyId, { status }));
      setNotice(status === "inactive" ? COPY.deactivated : COPY.reactivated);
      setConfirming(false);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : COPY.statusFailed);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <section
        role="alert"
        className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center shadow-sm"
      >
        <p className="text-overdue">{error}</p>
        <Button label={COPY.tryAgain} variant="secondary" onClick={retry} />
      </section>
    );
  }

  if (!property) return <PropertyLoading />;

  const { street, city, state, zip_code } = property.address;
  const active = property.status === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="break-words text-3xl font-semibold tracking-tight text-foreground">
          {property.property_name}
        </h1>
        {isAdmin && !confirming && (
          <div className="flex gap-3">
            <Link href={`/properties/${property.id}/edit`} className={linkButton}>
              {COPY.edit}
            </Link>
            {active ? (
              <Button
                label={COPY.deactivate}
                variant="secondary"
                onClick={() => {
                  setNotice(null);
                  setStatusError(null);
                  setConfirming(true);
                }}
              />
            ) : (
              <Button
                label={saving ? COPY.saving : COPY.reactivate}
                disabled={saving}
                aria-busy={saving}
                onClick={() => changeStatus("active")}
              />
            )}
          </div>
        )}
      </div>

      {notice && (
        <p role="status" className="text-sm text-paid">
          {notice}
        </p>
      )}

      {confirming && (
        <section
          aria-labelledby="confirm-deactivate"
          className="space-y-3 rounded-xl border border-due-soon bg-surface p-6 shadow-sm"
        >
          <h2 id="confirm-deactivate" className="text-lg font-semibold text-foreground">
            {COPY.deactivateQuestion(property.property_name)}
          </h2>
          <p className="text-sm text-foreground-muted">{COPY.deactivateEffect}</p>
          {accountCount !== null && accountCount > 0 && (
            <p className="text-sm font-medium text-due-soon">
              {COPY.accountsUsingIt(accountCount)}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              label={COPY.cancel}
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setStatusError(null);
                setConfirming(false);
              }}
            />
            <Button
              label={saving ? COPY.saving : COPY.confirmDeactivate}
              disabled={saving}
              aria-busy={saving}
              onClick={() => changeStatus("inactive")}
            />
          </div>
        </section>
      )}

      {statusError && (
        <p role="alert" className="rounded border border-overdue px-3 py-2 text-sm text-overdue">
          {statusError}
        </p>
      )}

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-sm text-foreground-muted">{COPY.address}</dt>
            <dd className="mt-1 font-medium text-foreground">
              <span className="block">{street}</span>
              <span className="block">{`${city}, ${state} ${zip_code}`}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-foreground-muted">{COPY.status}</dt>
            <dd className="mt-1">
              <StatusBadge status={property.status} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-foreground-muted">{COPY.createdAt}</dt>
            <dd className="mt-1 font-medium tabular-nums text-foreground">
              {formatDate(property.created_at)}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

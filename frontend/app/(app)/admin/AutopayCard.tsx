"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button/Button";
import { getAutopaySettings, updateAutopaySettings } from "@/lib/api/autopay-settings";
import { sanitizeCurrencyInput } from "@/lib/currency";
import type { AutopaySettings } from "@/types/autopay";

const COPY = {
  heading: "Autopay",
  explainer:
    "Approved bills up to this amount are paid by Claude automatically. A person still approves every bill.",
  toggle: "Pay approved bills automatically",
  limit: "Limit",
  currency: "$",
  save: "Save",
  saving: "Saving...",
  saved: "Autopay saved.",
  loading: "Loading autopay...",
  loadFailed: "Unable to load autopay.",
  saveFailed: "Unable to save autopay.",
  tryAgain: "Try again",
  limitRequired: "Enter a limit to turn on autopay.",
  limitInvalid: "Enter a dollar amount, like 500 or 500.50.",
  limitTooSmall: "The limit must be more than $0.",
  limitTooLarge: "The limit must be less than $10,000,000,000.",
  lastChanged: (who: string, when: string) => `Last changed by ${who} on ${when}.`,
};

const CURRENCY_PATTERN = /^\d+(\.\d{1,2})?$/;
// numeric(12,2) in the database.
const MAX_LIMIT = 10_000_000_000;

// "500" or "500.5" -> "500.00"; the empty string for no limit.
function limitText(limit: string | null): string {
  return limit === null ? "" : Number(limit).toFixed(2);
}

// What the limit field says is wrong, or null when it can be saved.
export function limitError(enabled: boolean, limit: string): string | null {
  const value = limit.trim();
  if (value === "") return enabled ? COPY.limitRequired : null;
  if (!CURRENCY_PATTERN.test(value)) return COPY.limitInvalid;
  if (Number(value) <= 0) return COPY.limitTooSmall;
  if (Number(value) >= MAX_LIMIT) return COPY.limitTooLarge;
  return null;
}

function formatChangedAt(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/\s/g, " ");
}

/**
 * The autopay setting, for active admins: on or off, and the limit. Approved
 * bills up to the limit get a payment run queued as soon as they are
 * approved. Renders nothing for anyone else.
 */
export default function AutopayCard() {
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = !authLoading && profile?.role === "admin" && profile.status === "active";

  const headingId = useId();
  const toggleLabelId = useId();
  const limitId = useId();
  const limitErrorId = useId();

  const [settings, setSettings] = useState<AutopaySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState("");
  // Shown only after Save, so typing never flashes an error.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `loadAttempt` re-runs the load on retry
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    getAutopaySettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setEnabled(result.enabled);
        setLimit(limitText(result.limit_amount));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error && error.message ? error.message : COPY.loadFailed);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, loadAttempt]);

  if (!isAdmin) return null;

  const changed =
    settings !== null &&
    (enabled !== settings.enabled || limit.trim() !== limitText(settings.limit_amount));

  function edit() {
    setFieldError(null);
    setSaveError(null);
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const error = limitError(enabled, limit);
    setFieldError(error);
    setSaveError(null);
    setSaved(false);
    if (error) return;

    const value = limit.trim();
    setSaving(true);
    try {
      const result = await updateAutopaySettings({
        enabled,
        limit_amount: value === "" ? null : Number(value).toFixed(2),
      });
      setSettings(result);
      setEnabled(result.enabled);
      setLimit(limitText(result.limit_amount));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : COPY.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <h2
        id={headingId}
        className="inline-block rounded bg-surface-muted px-3 py-1 text-xl font-medium text-foreground"
      >
        {COPY.heading}
      </h2>
      <p className="mt-3 text-sm text-foreground-muted">{COPY.explainer}</p>

      {loadError ? (
        <div role="alert" className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-overdue">{loadError}</p>
          <Button
            label={COPY.tryAgain}
            variant="secondary"
            onClick={() => {
              setLoadError(null);
              setLoadAttempt((n) => n + 1);
            }}
          />
        </div>
      ) : settings === null ? (
        <p role="status" className="mt-6 text-sm text-foreground-muted">
          {COPY.loading}
        </p>
      ) : (
        <form noValidate onSubmit={save} className="mt-6 space-y-6">
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby={toggleLabelId}
              onClick={() => {
                setEnabled((on) => !on);
                edit();
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                enabled ? "bg-primary" : "bg-foreground-muted/40"
              }`}
            >
              <span
                aria-hidden
                className={`inline-block size-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${
                  enabled ? "translate-x-5.5 bg-primary-foreground" : "translate-x-0.5 bg-surface"
                }`}
              />
            </button>
            <span id={toggleLabelId} className="pt-0.5 text-sm font-medium text-foreground">
              {COPY.toggle}
            </span>
          </div>

          <div>
            <label htmlFor={limitId} className="mb-2 block text-sm font-medium text-foreground">
              {COPY.limit}
            </label>
            <div
              className={`flex w-full max-w-xs items-center rounded-lg border bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-ring ${
                fieldError ? "border-overdue" : "border-border"
              }`}
            >
              <span aria-hidden className="mr-1 text-foreground-muted">
                {COPY.currency}
              </span>
              <input
                id={limitId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={limit}
                onChange={(event) => {
                  setLimit(sanitizeCurrencyInput(event.target.value));
                  edit();
                }}
                aria-invalid={fieldError !== null}
                aria-describedby={fieldError ? limitErrorId : undefined}
                className="w-full min-w-0 bg-transparent text-foreground tabular-nums outline-none"
              />
            </div>
            {fieldError && (
              <p id={limitErrorId} className="mt-1 text-sm text-overdue">
                {fieldError}
              </p>
            )}
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-overdue wrap-anywhere">
              {saveError}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p role="status" className="text-sm text-foreground-muted empty:hidden">
              {saved && <span className="font-medium text-paid">{`${COPY.saved} `}</span>}
              {settings.updated_by_name &&
                COPY.lastChanged(settings.updated_by_name, formatChangedAt(settings.updated_at))}
            </p>
            <Button
              type="submit"
              label={saving ? COPY.saving : COPY.save}
              disabled={saving || !changed}
              className="w-full shrink-0 sm:ml-auto sm:w-auto"
            />
          </div>
        </form>
      )}
    </section>
  );
}

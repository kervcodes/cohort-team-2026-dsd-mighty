"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import { lookUpVendorAccounts } from "@/lib/api/vendor-account-lookup";
import type { VendorAccountOption } from "@/types/vendor-account-lookup";

// How long typing pauses before the account number is looked up.
export const LOOKUP_DELAY_MS = 300;

const LABEL = "Vendor account";
const CHANGE = "Change";
const KEEP_CURRENT = "Keep current";
const LEAVE_FOR_LATER = "Leave for later";
const LOADING = "Loading vendor accounts...";
const PICKED = "Picked by you";
const MATCHED_BY_NUMBER = "Matched by account number";
const NO_MATCH = "No vendor account has this account number. Pick one, or leave it for later.";

function severalMatch(count: number): string {
  return `${count} vendor accounts have this account number. Pick one, or leave it for later.`;
}

function optionLabel(account: VendorAccountOption): string {
  return `${account.vendor_name} · ${account.account_number} · ${account.property_name}`;
}

type VendorAccountFieldProps = {
  // The bill's account number as typed or read from the PDF.
  accountNumber: string;
  // The account the analyst picked, or "" to leave it to the server, which
  // matches the account number when exactly one active account has it.
  value: string;
  onChange: (vendorAccountId: string) => void;
};

// Shows which vendor account the bill goes to. A picked account, or else the
// one account whose number matches, shows as matched with "Change", saying
// which of the two it is. With no match, or several, a select offers every
// account or the candidates.
export function VendorAccountField({ accountNumber, value, onChange }: VendorAccountFieldProps) {
  const [accounts, setAccounts] = useState<VendorAccountOption[] | null>(null);
  // The accounts the last looked-up account number matched: null with no
  // number, undefined until the first lookup answers.
  const [lookup, setLookup] = useState<VendorAccountOption[] | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const wanted = accountNumber.trim();
  // Switching between the matched view and the select keeps focus on the
  // field: the control that replaced the one in use takes it.
  const moveFocus = useRef(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (changeButton.current ?? select.current)?.focus();
  });

  function switchTo(next: boolean) {
    moveFocus.current = true;
    setChanging(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    lookUpVendorAccounts(undefined, controller.signal).then(setAccounts, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Unable to load vendor accounts.");
    });
    return () => controller.abort();
  }, []);

  // While a lookup waits, the last answer stays on screen, so typing does
  // not make the field flicker. Saving does not depend on it: with no pick,
  // the server matches the number it receives.
  useEffect(() => {
    if (!wanted) {
      setLookup(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookUpVendorAccounts(wanted, controller.signal).then(
        (matches) => {
          setLookup(matches);
          setError("");
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Unable to look up vendor accounts.");
        },
      );
    }, LOOKUP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wanted]);

  const picked = value ? accounts?.find((account) => account.id === value) : undefined;

  // A saved pick that is no longer active can't be sent again: let the
  // account number decide instead.
  useEffect(() => {
    if (value && accounts && !picked) onChange("");
  }, [value, accounts, picked, onChange]);

  const matches = wanted && lookup ? lookup : [];
  const autoMatch = matches.length === 1 ? matches[0] : undefined;
  const shown = value ? picked : autoMatch;
  // A pick waits for the account list. A number the field opened with (a
  // reopened draft) waits for its first lookup, so the select does not
  // flash before the match shows. Later lookups keep the last answer.
  const loading = !error && (value ? accounts === null : wanted !== "" && lookup === undefined);

  if (loading) {
    return (
      <FormField label={LABEL} htmlFor="vendorAccount">
        {(field) => (
          <output {...field} className="block text-sm text-foreground-muted">
            {LOADING}
          </output>
        )}
      </FormField>
    );
  }

  if (shown && !changing) {
    return (
      <FormField label={LABEL} htmlFor="vendorAccount" error={error || undefined}>
        {(field) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2">
            <output {...field} className="flex min-w-0 items-start gap-2 text-sm">
              <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-paid" />
              <span className="min-w-0">
                <span className="block font-medium wrap-break-word text-foreground">
                  {shown.vendor_name}
                </span>
                <span className="block wrap-break-word text-foreground-muted">
                  {`${shown.account_number} · ${shown.property_name}`}
                </span>
                <span className="mt-0.5 block text-xs text-foreground-muted">
                  {value ? PICKED : MATCHED_BY_NUMBER}
                </span>
              </span>
            </output>
            <button
              ref={changeButton}
              type="button"
              onClick={() => switchTo(true)}
              className="shrink-0 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CHANGE}
            </button>
          </div>
        )}
      </FormField>
    );
  }

  // Changing a shown account lists them all. Otherwise: the candidates when
  // several match, else every account.
  const everyAccount = accounts ?? (shown ? [shown] : []);
  const options = !changing && matches.length > 1 ? matches : everyAccount;
  // "" means no pick, which a match would override, so it is offered only
  // when no account matches.
  const canLeaveEmpty = !autoMatch;
  const selected = changing && shown ? shown.id : value;
  const note =
    changing || !wanted || !lookup
      ? undefined
      : matches.length === 0
        ? NO_MATCH
        : matches.length > 1
          ? severalMatch(matches.length)
          : undefined;

  return (
    <FormField label={LABEL} htmlFor="vendorAccount" note={note} error={error || undefined}>
      {(field) => (
        <div className="flex items-center gap-3">
          <select
            {...field}
            ref={select}
            value={selected}
            onChange={(event) => {
              onChange(event.target.value);
              switchTo(false);
            }}
            className={`${inputClass} min-w-0 flex-1`}
          >
            {canLeaveEmpty && <option value="">{LEAVE_FOR_LATER}</option>}
            {options.map((account) => (
              <option key={account.id} value={account.id}>
                {optionLabel(account)}
              </option>
            ))}
          </select>
          {changing && (
            <button
              type="button"
              onClick={() => switchTo(false)}
              className="shrink-0 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {KEEP_CURRENT}
            </button>
          )}
        </div>
      )}
    </FormField>
  );
}

"use client";

import { Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { DataTable, type DataTableColumn } from "@/components/DataTable/DataTable";
import { listAllProperties, type PropertyRead } from "@/lib/api/properties";
import { listVendorAccounts } from "@/lib/api/vendor-accounts";
import { getVendor, paymentMethodLabels, type Vendor } from "@/lib/api/vendors";
import type { VendorAccount } from "@/types/vendor-account";
import AccountFormDialog from "./AccountFormDialog";

const COPY = {
  loading: "Loading vendor...",
  loadFailed: "Unable to load the vendor.",
  tryAgain: "Try again",
  contact: "Contact",
  email: "Email",
  phone: "Phone",
  defaultPaymentMethod: "Default payment method",
  accounts: "Accounts",
  addAccount: "Add account",
  empty: "No accounts yet.",
  emptyForAdmin: 'No accounts yet. Click "Add account" to add one.',
  accountAdded: "Account added.",
  accountUpdated: "Account updated.",
  accountNumber: "Account number",
  type: "Type",
  property: "Property",
  paymentMethod: "Payment method",
  portal: "Portal",
  portalLoginEmail: "Portal login email",
  password: "Password",
  passwordSet: "Set",
  passwordNotSet: "Not set",
  actions: "Actions",
  edit: "Edit",
  editAccount: (accountNumber: string) => `Edit account ${accountNumber}`,
  notSet: "-",
};

type PageData = {
  vendor: Vendor;
  accounts: VendorAccount[];
  properties: PropertyRead[];
};

// null: closed. { account: null }: adding. { account }: editing that one.
type DialogState = { account: VendorAccount | null } | null;

const linkClass =
  "rounded font-medium text-primary hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Shown without the scheme or a trailing slash. The backend only stores http
// and https addresses; anything else is shown as text, never as a link.
function PortalLink({ url }: { url: string }) {
  const text = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) return <span className="block truncate">{url}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className={`block truncate ${linkClass}`}
    >
      {text}
    </a>
  );
}

// Every cell stays on one line; the table scrolls inside its card when the
// row is wider than the screen.
const ONE_LINE = "whitespace-nowrap";
// The portal column takes the width the others leave and cuts a long address
// with an ellipsis, but never shrinks below min-w-40 (the card scrolls instead).
const FILL = "w-full min-w-40 max-w-0 whitespace-nowrap";

// Same order as GET /vendors/:id/accounts.
function byAccountNumber(a: VendorAccount, b: VendorAccount) {
  return a.account_number.localeCompare(b.account_number);
}

// While the vendor loads; also the page's Suspense fallback.
export function VendorLoading() {
  return (
    <p role="status" className="mt-6 text-foreground-muted">
      {COPY.loading}
    </p>
  );
}

/**
 * The vendor at /vendors/:vendorId, its contact info and its accounts. Admins
 * add and edit accounts; everyone else reads. Reads `useParams`, so the page
 * renders it inside Suspense.
 */
export default function VendorDetail() {
  const { vendorId } = useParams<{ vendorId: string }>();
  const { profile, loading: authLoading } = useAuth();
  // Hidden until the profile is known, so it never flashes for other roles.
  // The backend refuses account changes from anyone but an admin.
  const isAdmin = !authLoading && profile?.role === "admin";

  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry
  useEffect(() => {
    let cancelled = false;

    Promise.all([getVendor(vendorId), listVendorAccounts(vendorId), listAllProperties()])
      .then(([vendor, accounts, properties]) => {
        if (cancelled) return;
        setData({ vendor, accounts, properties });
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : COPY.loadFailed);
      });

    return () => {
      cancelled = true;
    };
  }, [vendorId, attempt]);

  function retry() {
    setError(null);
    setAttempt((n) => n + 1);
  }

  const propertyNames = useMemo(
    () => new Map(data?.properties.map((property) => [property.id, property.property_name])),
    [data],
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  function openDialog(account: VendorAccount | null) {
    setNotice(null);
    setDialog({ account });
  }

  function handleSaved(saved: VendorAccount) {
    setData((current) =>
      current
        ? {
            ...current,
            accounts: [
              ...current.accounts.filter((account) => account.id !== saved.id),
              saved,
            ].sort(byAccountNumber),
          }
        : current,
    );
    setNotice(dialog?.account ? COPY.accountUpdated : COPY.accountAdded);
    setDialog(null);
  }

  const columns: DataTableColumn<VendorAccount>[] = [
    { header: COPY.accountNumber, className: ONE_LINE, cell: (account) => account.account_number },
    { header: COPY.type, className: ONE_LINE, cell: (account) => account.account_type },
    {
      header: COPY.property,
      className: ONE_LINE,
      cell: (account) => propertyNames.get(account.property_id) ?? COPY.notSet,
    },
    {
      header: COPY.paymentMethod,
      className: ONE_LINE,
      cell: (account) => paymentMethodLabels[account.payment_method],
    },
    {
      header: COPY.portal,
      className: FILL,
      cell: (account) =>
        account.portal_url ? <PortalLink url={account.portal_url} /> : COPY.notSet,
    },
    {
      header: COPY.portalLoginEmail,
      className: ONE_LINE,
      cell: (account) => account.portal_login_email ?? COPY.notSet,
    },
    {
      header: COPY.password,
      className: ONE_LINE,
      cell: (account) => (account.portal_password_set ? COPY.passwordSet : COPY.passwordNotSet),
    },
  ];

  if (isAdmin) {
    columns.push({
      header: COPY.actions,
      align: "right",
      className: ONE_LINE,
      cell: (account) => (
        <button
          type="button"
          onClick={() => openDialog(account)}
          aria-label={COPY.editAccount(account.account_number)}
          className={linkClass}
        >
          {COPY.edit}
        </button>
      ),
    });
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

  if (!data) return <VendorLoading />;

  const { vendor, accounts, properties } = data;
  return (
    <div className="space-y-6">
      <h1 className="break-words text-3xl font-semibold tracking-tight text-foreground">
        {vendor.name}
      </h1>

      <section
        aria-labelledby="vendor-contact"
        className="rounded-xl border border-border bg-surface p-6 shadow-sm"
      >
        <h2 id="vendor-contact" className="text-lg font-semibold text-foreground">
          {COPY.contact}
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-sm text-foreground-muted">{COPY.email}</dt>
            <dd className="mt-1 break-all font-medium text-foreground">
              {vendor.contact_email ?? COPY.notSet}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-foreground-muted">{COPY.phone}</dt>
            <dd className="mt-1 font-medium text-foreground">
              {vendor.contact_phone ?? COPY.notSet}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-foreground-muted">{COPY.defaultPaymentMethod}</dt>
            <dd className="mt-1 font-medium text-foreground">
              {vendor.default_payment_method
                ? paymentMethodLabels[vendor.default_payment_method]
                : COPY.notSet}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="vendor-accounts" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="vendor-accounts" className="text-lg font-semibold text-foreground">
            {COPY.accounts}
          </h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => openDialog(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus aria-hidden={true} className="h-4 w-4" />
              {COPY.addAccount}
            </button>
          )}
        </div>

        {notice && (
          <p role="status" className="text-sm text-paid">
            {notice}
          </p>
        )}

        <DataTable
          label={COPY.accounts}
          columns={columns}
          rows={accounts}
          getRowKey={(account) => account.id}
          compact
          emptyMessage={isAdmin ? COPY.emptyForAdmin : COPY.empty}
        />
      </section>

      {isAdmin && dialog && (
        <AccountFormDialog
          vendorId={vendor.id}
          vendorPaymentMethod={vendor.default_payment_method}
          account={dialog.account}
          properties={properties}
          onSaved={handleSaved}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

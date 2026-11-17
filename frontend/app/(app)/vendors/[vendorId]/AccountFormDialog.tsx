"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import { ApiError } from "@/lib/api/http";
import type { PropertyRead } from "@/lib/api/properties";
import { createVendorAccount, updateVendorAccount } from "@/lib/api/vendor-accounts";
import { type PaymentMethod, paymentMethodLabels, paymentMethods } from "@/lib/api/vendors";
import {
  toCreatePayload,
  toUpdatePayload,
  type VendorAccountFormInput,
  type VendorAccountFormValues,
  vendorAccountDefaults,
  vendorAccountFormSchema,
} from "@/lib/vendor-account-form-schema";
import type { VendorAccount } from "@/types/vendor-account";

const COPY = {
  addTitle: "Add account",
  editTitle: "Edit account",
  closeDialog: "Close dialog",
  property: "Property",
  chooseProperty: "Choose a property",
  noProperties: "No active properties",
  propertyLocked: "Can't be changed",
  accountNumber: "Account number",
  accountType: "Account type",
  accountTypePlaceholder: "For example, water",
  paymentMethod: "Payment method",
  choosePaymentMethod: "Choose a payment method",
  portalUrl: "Portal address",
  portalUrlPlaceholder: "https://portal.example.com",
  portalLoginEmail: "Portal login email",
  portalPassword: "Portal password",
  optional: "Optional",
  keepPassword: "Leave blank to keep the current password.",
  passwordWillBeRemoved: "The password will be removed when you save.",
  removePassword: "Remove password",
  undoRemovePassword: "Keep password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  cancel: "Cancel",
  add: "Add account",
  adding: "Adding...",
  save: "Save changes",
  saving: "Saving...",
  duplicate: "This account number is already set up for this property.",
  invalid: (detail: string) => `Some details were not accepted: ${detail}`,
  saveFailed: "Unable to save the account.",
};

const fieldClass = `${inputClass} disabled:cursor-not-allowed disabled:opacity-60`;

const textButton =
  "rounded text-sm font-medium text-primary hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Props = {
  vendorId: string;
  vendorPaymentMethod: PaymentMethod | null;
  // The account to edit, or null to add one.
  account: VendorAccount | null;
  properties: PropertyRead[];
  onSaved: (account: VendorAccount) => void;
  onClose: () => void;
};

/**
 * Adds or edits one vendor account. The password field always starts empty:
 * the API never returns a password, only whether one is set. Mount it fresh
 * for each open, so a typed password never outlives the dialog.
 */
export default function AccountFormDialog({
  vendorId,
  vendorPaymentMethod,
  account,
  properties,
  onSaved,
  onClose,
}: Props) {
  const titleId = useId();
  const passwordHelpId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [removePassword, setRemovePassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<VendorAccountFormInput, unknown, VendorAccountFormValues>({
    resolver: zodResolver(vendorAccountFormSchema),
    defaultValues: vendorAccountDefaults(account, vendorPaymentMethod),
  });

  const isEdit = account !== null;
  // A new account goes on an active property; an existing one keeps its own.
  const propertyOptions = isEdit
    ? properties.filter((property) => property.id === account.property_id)
    : properties.filter((property) => property.status === "active");

  // Focus the first field on open, and give focus back on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    setFocus(isEdit ? "accountNumber" : "propertyId");
    return () => previouslyFocused?.focus();
  }, [isEdit, setFocus]);

  // Escape closes the dialog, but not while a save is in flight.
  useEffect(() => {
    if (isSubmitting) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose]);

  function toggleRemovePassword() {
    setValue("portalPassword", "");
    setShowPassword(false);
    setRemovePassword((remove) => !remove);
  }

  async function onSubmit(values: VendorAccountFormValues) {
    setSubmitError(null);
    let saved: VendorAccount;
    try {
      saved = account
        ? await updateVendorAccount(account.id, toUpdatePayload(values, removePassword))
        : await createVendorAccount(toCreatePayload(vendorId, values));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("accountNumber", { message: COPY.duplicate }, { shouldFocus: true });
      } else if (err instanceof ApiError && err.status === 422) {
        setSubmitError(COPY.invalid(err.message));
      } else {
        setSubmitError(err instanceof Error ? err.message : COPY.saveFailed);
      }
      return;
    }
    onSaved(saved);
  }

  const passwordHelp = removePassword
    ? COPY.passwordWillBeRemoved
    : account?.portal_password_set
      ? COPY.keepPassword
      : null;

  let submitLabel = isEdit ? COPY.save : COPY.add;
  if (isSubmitting) submitLabel = isEdit ? COPY.saving : COPY.adding;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={COPY.closeDialog}
        tabIndex={-1}
        onClick={isSubmitting ? undefined : onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 id={titleId} className="mb-5 text-xl font-semibold text-foreground">
          {isEdit ? COPY.editTitle : COPY.addTitle}
        </h2>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            label={COPY.property}
            htmlFor="account-property"
            hint={isEdit ? COPY.propertyLocked : undefined}
            error={errors.propertyId?.message}
          >
            {(field) =>
              isEdit ? (
                // Not registered: a disabled field submits no value, and the
                // property is not sent on edit anyway.
                <select
                  {...field}
                  disabled
                  defaultValue={account.property_id}
                  className={fieldClass}
                >
                  {propertyOptions.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.property_name}
                    </option>
                  ))}
                </select>
              ) : (
                <select {...field} {...register("propertyId")} className={fieldClass}>
                  <option value="">
                    {propertyOptions.length ? COPY.chooseProperty : COPY.noProperties}
                  </option>
                  {propertyOptions.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.property_name}
                    </option>
                  ))}
                </select>
              )
            }
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={COPY.accountNumber}
              htmlFor="account-number"
              error={errors.accountNumber?.message}
            >
              {(field) => (
                <input
                  {...field}
                  {...register("accountNumber")}
                  autoComplete="off"
                  className={fieldClass}
                />
              )}
            </FormField>
            <FormField
              label={COPY.accountType}
              htmlFor="account-type"
              error={errors.accountType?.message}
            >
              {(field) => (
                <input
                  {...field}
                  {...register("accountType")}
                  autoComplete="off"
                  placeholder={COPY.accountTypePlaceholder}
                  className={fieldClass}
                />
              )}
            </FormField>
          </div>

          <FormField
            label={COPY.paymentMethod}
            htmlFor="account-payment-method"
            error={errors.paymentMethod?.message}
          >
            {(field) => (
              <select {...field} {...register("paymentMethod")} className={fieldClass}>
                <option value="">{COPY.choosePaymentMethod}</option>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {paymentMethodLabels[method]}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField
            label={COPY.portalUrl}
            htmlFor="account-portal-url"
            hint={COPY.optional}
            error={errors.portalUrl?.message}
          >
            {(field) => (
              <input
                {...field}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder={COPY.portalUrlPlaceholder}
                {...register("portalUrl")}
                className={fieldClass}
              />
            )}
          </FormField>

          <FormField
            label={COPY.portalLoginEmail}
            htmlFor="account-portal-email"
            hint={COPY.optional}
            error={errors.portalLoginEmail?.message}
          >
            {(field) => (
              // "off": the browser must not fill in the admin's own email.
              <input
                {...field}
                type="email"
                autoComplete="off"
                {...register("portalLoginEmail")}
                className={fieldClass}
              />
            )}
          </FormField>

          <FormField
            label={COPY.portalPassword}
            htmlFor="account-portal-password"
            hint={COPY.optional}
            error={errors.portalPassword?.message}
          >
            {(field) => (
              <div className="space-y-1.5">
                <div className="relative">
                  {/* "new-password": the browser must not fill in the admin's own password. */}
                  <input
                    {...field}
                    aria-describedby={
                      [field["aria-describedby"], passwordHelp ? passwordHelpId : null]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    // Read-only, not disabled: a disabled field submits no value.
                    readOnly={removePassword}
                    {...register("portalPassword")}
                    className={`${fieldClass} pr-10 read-only:cursor-not-allowed read-only:opacity-60`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((show) => !show)}
                    disabled={removePassword}
                    aria-label={showPassword ? COPY.hidePassword : COPY.showPassword}
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-foreground-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {(passwordHelp || account?.portal_password_set) && (
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    {passwordHelp && (
                      <p id={passwordHelpId} className="text-xs text-foreground-muted">
                        {passwordHelp}
                      </p>
                    )}
                    {account?.portal_password_set && (
                      <button type="button" onClick={toggleRemovePassword} className={textButton}>
                        {removePassword ? COPY.undoRemovePassword : COPY.removePassword}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </FormField>

          {submitError && (
            <p
              role="alert"
              className="rounded border border-overdue px-3 py-2 text-sm text-overdue"
            >
              {submitError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button
              label={COPY.cancel}
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            />
            <Button
              type="submit"
              label={submitLabel}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

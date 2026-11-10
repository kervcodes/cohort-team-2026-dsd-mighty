"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/ui/button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import PageHeader from "@/components/PageHeader/PageHeader";
import { createVendor, paymentMethodLabels, paymentMethods } from "@/lib/api/vendors";
import {
  toVendorPayload,
  type VendorFormValues,
  vendorDefaults,
  vendorFormSchema,
} from "@/lib/vendor-form-schema";

const COPY = {
  title: "New vendor",
  loading: "Loading...",
  adminsOnly: "Only admins can add vendors.",
  backToVendors: "Back to vendors",
  vendorName: "Vendor name",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  paymentMethod: "Default payment method",
  optional: "Optional",
  noPaymentMethod: "None",
  cancel: "Cancel",
  create: "Add vendor",
  creating: "Adding...",
  createFailed: "Unable to add the vendor.",
};

const linkButton =
  "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function NewVendorPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: vendorDefaults,
  });

  async function onSubmit(values: VendorFormValues) {
    setSubmitError(null);
    try {
      await createVendor(toVendorPayload(values));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : COPY.createFailed);
      return;
    }
    // Next.js keeps this page's state across navigations, so clear the form
    // before leaving or it is still filled in on the next visit.
    reset();
    router.push("/vendors");
  }

  let content: React.ReactNode;
  if (loading) {
    content = <p role="status">{COPY.loading}</p>;
  } else if (profile?.role !== "admin") {
    // The backend refuses POST /vendors from anyone else; this only explains it.
    content = (
      <div className="space-y-4">
        <p className="text-foreground-muted">{COPY.adminsOnly}</p>
        <Link href="/vendors" className={linkButton}>
          {COPY.backToVendors}
        </Link>
      </div>
    );
  } else {
    content = (
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField label={COPY.vendorName} htmlFor="vendor-name" error={errors.name?.message}>
          {(field) => <input {...field} {...register("name")} className={inputClass} />}
        </FormField>
        <FormField
          label={COPY.contactEmail}
          htmlFor="vendor-email"
          hint={COPY.optional}
          error={errors.contactEmail?.message}
        >
          {(field) => (
            <input {...field} type="email" {...register("contactEmail")} className={inputClass} />
          )}
        </FormField>
        <FormField
          label={COPY.contactPhone}
          htmlFor="vendor-phone"
          hint={COPY.optional}
          error={errors.contactPhone?.message}
        >
          {(field) => (
            <input {...field} type="tel" {...register("contactPhone")} className={inputClass} />
          )}
        </FormField>
        <FormField
          label={COPY.paymentMethod}
          htmlFor="vendor-payment-method"
          hint={COPY.optional}
          error={errors.paymentMethod?.message}
        >
          {(field) => (
            <select {...field} {...register("paymentMethod")} className={inputClass}>
              <option value="">{COPY.noPaymentMethod}</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {paymentMethodLabels[method]}
                </option>
              ))}
            </select>
          )}
        </FormField>

        {submitError && (
          <p role="alert" className="rounded border border-overdue px-3 py-2 text-sm text-overdue">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/vendors" className={linkButton}>
            {COPY.cancel}
          </Link>
          <Button
            type="submit"
            label={isSubmitting ? COPY.creating : COPY.create}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          />
        </div>
      </form>
    );
  }

  return (
    <div className="mx-auto w-full max-w-200 space-y-6 pt-16">
      <PageHeader title={COPY.title} hasCta={false} />
      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        {content}
      </section>
    </div>
  );
}

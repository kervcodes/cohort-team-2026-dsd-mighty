"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import PageHeader from "@/components/PageHeader/PageHeader";
import { createProperty } from "@/lib/api/properties";
import {
  type PropertyFormInput,
  type PropertyFormValues,
  propertyDefaults,
  propertyFormSchema,
  toPropertyPayload,
} from "@/lib/property-form-schema";

const COPY = {
  title: "New property",
  loading: "Loading...",
  adminsOnly: "Only admins can add properties.",
  backToProperties: "Back to properties",
  propertyName: "Property name",
  street: "Street",
  city: "City",
  state: "State",
  zipCode: "ZIP code",
  cancel: "Cancel",
  create: "Add property",
  creating: "Adding...",
  createFailed: "Unable to add the property.",
};

const linkButton =
  "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function NewPropertyPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PropertyFormInput, unknown, PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: propertyDefaults,
  });

  async function onSubmit(values: PropertyFormValues) {
    setSubmitError(null);
    try {
      await createProperty(toPropertyPayload(values));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : COPY.createFailed);
      return;
    }
    // Next.js keeps this page's state across navigations, so clear the form
    // before leaving or it is still filled in on the next visit.
    reset();
    router.push("/properties");
  }

  let content: React.ReactNode;
  if (loading) {
    content = <p role="status">{COPY.loading}</p>;
  } else if (profile?.role !== "admin") {
    // The backend refuses POST /properties from anyone else; this only explains it.
    content = (
      <div className="space-y-4">
        <p className="text-foreground-muted">{COPY.adminsOnly}</p>
        <Link href="/properties" className={linkButton}>
          {COPY.backToProperties}
        </Link>
      </div>
    );
  } else {
    content = (
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField label={COPY.propertyName} htmlFor="property-name" error={errors.name?.message}>
          {(field) => <input {...field} {...register("name")} className={inputClass} />}
        </FormField>
        <FormField label={COPY.street} htmlFor="property-street" error={errors.street?.message}>
          {(field) => (
            <input
              {...field}
              autoComplete="address-line1"
              {...register("street")}
              className={inputClass}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <FormField label={COPY.city} htmlFor="property-city" error={errors.city?.message}>
            {(field) => (
              <input
                {...field}
                autoComplete="address-level2"
                {...register("city")}
                className={inputClass}
              />
            )}
          </FormField>
          <FormField label={COPY.state} htmlFor="property-state" error={errors.state?.message}>
            {(field) => (
              <input
                {...field}
                autoComplete="address-level1"
                maxLength={2}
                {...register("state")}
                className={`${inputClass} uppercase`}
              />
            )}
          </FormField>
          <FormField label={COPY.zipCode} htmlFor="property-zip" error={errors.zipCode?.message}>
            {(field) => (
              <input
                {...field}
                autoComplete="postal-code"
                inputMode="numeric"
                {...register("zipCode")}
                className={inputClass}
              />
            )}
          </FormField>
        </div>

        {submitError && (
          <p role="alert" className="rounded border border-overdue px-3 py-2 text-sm text-overdue">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/properties" className={linkButton}>
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

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import {
  type PropertyFormInput,
  type PropertyFormValues,
  propertyFormSchema,
} from "@/lib/property-form-schema";

const COPY = {
  propertyName: "Property name",
  street: "Street",
  city: "City",
  state: "State",
  zipCode: "ZIP code",
  cancel: "Cancel",
};

export const linkButton =
  "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The property name and address fields, shared by /properties/new and
 * /properties/:id/edit. `onSubmit` saves the values, or
 * throws with a message to show; when it resolves the page navigates away.
 * `clearOnSave` empties the form first: Next.js keeps a page's state across
 * navigations, so a create form would still be filled in on the next visit.
 */
export function PropertyForm({
  defaultValues,
  submitLabel,
  submittingLabel,
  failedMessage,
  cancelHref,
  clearOnSave = false,
  onSubmit,
}: {
  defaultValues: PropertyFormInput;
  submitLabel: string;
  submittingLabel: string;
  failedMessage: string;
  cancelHref: string;
  clearOnSave?: boolean;
  onSubmit: (values: PropertyFormValues) => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PropertyFormInput, unknown, PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues,
  });

  async function submit(values: PropertyFormValues) {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : failedMessage);
      return;
    }
    if (clearOnSave) reset();
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
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
        <Link href={cancelHref} className={linkButton}>
          {COPY.cancel}
        </Link>
        <Button
          type="submit"
          label={isSubmitting ? submittingLabel : submitLabel}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        />
      </div>
    </form>
  );
}

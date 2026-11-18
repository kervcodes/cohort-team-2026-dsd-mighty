"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import Button from "@/components/Button";
import { linkButton, PropertyForm } from "@/components/Property/PropertyForm";
import { getProperty, type PropertyRead, updateProperty } from "@/lib/api/properties";
import {
  fromProperty,
  type PropertyFormValues,
  toPropertyPayload,
} from "@/lib/property-form-schema";

const COPY = {
  loading: "Loading...",
  loadFailed: "Unable to load the property.",
  tryAgain: "Try again",
  adminsOnly: "Only admins can change properties.",
  backToProperty: "Back to property",
  save: "Save changes",
  saving: "Saving...",
  saveFailed: "Unable to save the property.",
};

/**
 * The edit form at /properties/:propertyId/edit, filled in with the saved
 * property. Saving sends the name and the whole address, then returns to the
 * property. Reads `useParams`, so the page renders it inside Suspense.
 */
export default function EditProperty() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";
  const propertyHref = `/properties/${propertyId}`;

  const [property, setProperty] = useState<PropertyRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry
  useEffect(() => {
    if (authLoading || !isAdmin) return;
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

    return () => {
      cancelled = true;
    };
  }, [propertyId, attempt, authLoading, isAdmin]);

  async function onSubmit(values: PropertyFormValues) {
    const { property_name, address } = toPropertyPayload(values);
    await updateProperty(propertyId, { property_name, address });
    router.push(propertyHref);
  }

  if (authLoading) return <p role="status">{COPY.loading}</p>;

  if (!isAdmin) {
    // The backend refuses PATCH /properties/:id from anyone else; this only explains it.
    return (
      <div className="space-y-4">
        <p className="text-foreground-muted">{COPY.adminsOnly}</p>
        <Link href={propertyHref} className={linkButton}>
          {COPY.backToProperty}
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-overdue">{error}</p>
        <Button
          label={COPY.tryAgain}
          variant="secondary"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  if (!property) return <p role="status">{COPY.loading}</p>;

  return (
    <PropertyForm
      defaultValues={fromProperty(property)}
      submitLabel={COPY.save}
      submittingLabel={COPY.saving}
      failedMessage={COPY.saveFailed}
      cancelHref={propertyHref}
      onSubmit={onSubmit}
    />
  );
}

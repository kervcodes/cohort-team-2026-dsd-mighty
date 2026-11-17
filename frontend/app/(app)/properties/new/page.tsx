"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/auth/AuthProvider";
import PageHeader from "@/components/PageHeader/PageHeader";
import { linkButton, PropertyForm } from "@/components/Property/PropertyForm";
import { createProperty } from "@/lib/api/properties";
import {
  type PropertyFormValues,
  propertyDefaults,
  toPropertyPayload,
} from "@/lib/property-form-schema";

const COPY = {
  title: "New property",
  loading: "Loading...",
  adminsOnly: "Only admins can add properties.",
  backToProperties: "Back to properties",
  create: "Add property",
  creating: "Adding...",
  createFailed: "Unable to add the property.",
};

export default function NewPropertyPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();

  async function onSubmit(values: PropertyFormValues) {
    await createProperty(toPropertyPayload(values));
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
      <PropertyForm
        defaultValues={propertyDefaults}
        submitLabel={COPY.create}
        submittingLabel={COPY.creating}
        failedMessage={COPY.createFailed}
        cancelHref="/properties"
        clearOnSave={true}
        onSubmit={onSubmit}
      />
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

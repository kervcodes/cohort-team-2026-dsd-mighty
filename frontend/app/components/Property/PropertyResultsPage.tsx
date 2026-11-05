"use client";
import { useAuth } from "@/auth/AuthProvider";
import type { Property } from "@/types/property";
import PageHeader from "../PageHeader/PageHeader";
import { PropertyTable } from "./PropertyTable";
export default function PropertyResultsPage({ properties }: { properties: Property[] }) {
  const { profile } = useAuth();
  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      <PageHeader title="Properties" hasCta={profile?.role === "admin"} ctaText="Add Property" />
      <PropertyTable properties={properties} userRole={profile?.role ?? "analyst"} />
    </div>
  );
}

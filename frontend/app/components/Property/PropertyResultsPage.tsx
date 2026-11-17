"use client";
import { useAuth } from "@/auth/AuthProvider";
import type { Property } from "@/types/property";
import PageHeader from "../PageHeader/PageHeader";
import { PropertyTable } from "./PropertyTable";
export default function PropertyResultsPage({ properties }: { properties: Property[] }) {
  const { profile, loading } = useAuth();
  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      {/* dont want to have a loading widget for cases of non admin once auth is resolved, there would be add new button */}
      {!loading && profile?.role === "admin" ? (
        <PageHeader
          title="Properties"
          hasCta={true}
          ctaText="Add Property"
          ctaLink="/properties/new"
        />
      ) : (
        <PageHeader title="Properties" hasCta={false} />
      )}

      {loading ? (
        <p>Loading properties...</p>
      ) : (
        <PropertyTable properties={properties} userRole={profile?.role ?? "analyst"} />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import PropertyResultsPage from "@/components/Property/PropertyResultsPage";
import { listAllProperties } from "@/lib/api/properties";
import { toProperty } from "@/lib/properties";
import type { Property } from "@/types/property";

const LOAD_FAILED = "Unable to load properties.";

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listAllProperties()
      .then((loaded) => {
        if (current) setProperties(loaded.map(toProperty));
      })
      .catch((err) => {
        if (current) setError(err instanceof Error ? err.message : LOAD_FAILED);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <PropertyResultsPage properties={properties} loadingProperties={loading} loadError={error} />
  );
}

import PropertyResultsPage from "@/components/Property/PropertyResultsPage";
import type { Property } from "@/types/property";

export default function PropertiesPage() {
  // do a call to get properties
  const properties: Property[] = [];

  return <PropertyResultsPage properties={properties} />;
}

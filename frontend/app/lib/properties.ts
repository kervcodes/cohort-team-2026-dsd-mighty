import type { PropertyRead } from "@/lib/api/properties";
import type { Property } from "@/types/property";

// The properties table shows the flat row; the API nests the address.
export function toProperty(property: PropertyRead): Property {
  return {
    property_id: property.id,
    property_name: property.property_name,
    ...property.address,
    status: property.status,
    created_at: property.created_at,
  };
}

import type { EntityStatus } from "@/types/entity";
import { apiRequest } from "./http";

// Backend PropertyRead, as GET /properties returns it. (`types/property.ts`
// is the flat database row the properties page was sketched with.)
export type PropertyRead = {
  id: string;
  property_name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip_code: string;
  };
  status: EntityStatus;
  created_at: string;
};

// Backend PagePropertyRead: `total` counts every property, not just this page.
export type PropertyPage = {
  items: PropertyRead[];
  total: number;
  skip: number;
  limit: number;
};

// Body of POST /properties (backend PropertyCreate). `status` defaults to
// "active" on the server.
export type PropertyCreatePayload = {
  property_name: string;
  address: PropertyRead["address"];
  status?: EntityStatus;
};

export function createProperty(payload: PropertyCreatePayload): Promise<PropertyRead> {
  return apiRequest<PropertyRead>(
    "/properties",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { signedOut: "You must be signed in to add a property.", failed: "Unable to add the property" },
  );
}

// Body of PATCH /properties/:id (backend PropertyUpdate): only the fields to
// change. A new address replaces the whole address; null is refused.
export type PropertyUpdatePayload = Partial<Omit<PropertyCreatePayload, "status">> & {
  status?: EntityStatus;
};

export function getProperty(propertyId: string): Promise<PropertyRead> {
  return apiRequest<PropertyRead>(
    `/properties/${encodeURIComponent(propertyId)}`,
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to view this property.",
      failed: "Unable to load the property",
    },
  );
}

export function updateProperty(
  propertyId: string,
  payload: PropertyUpdatePayload,
): Promise<PropertyRead> {
  return apiRequest<PropertyRead>(
    `/properties/${encodeURIComponent(propertyId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    {
      signedOut: "You must be signed in to change a property.",
      failed: "Unable to save the property",
    },
  );
}

// The most GET /properties returns in one page.
export const MAX_PAGE_SIZE = 100;

export function listProperties(skip = 0, limit = MAX_PAGE_SIZE): Promise<PropertyPage> {
  const query = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  return apiRequest<PropertyPage>(
    `/properties?${query}`,
    { method: "GET" },
    {
      signedOut: "You must be signed in to view properties.",
      failed: "Unable to load properties",
    },
  );
}

// Every property, sorted by name, one page at a time.
export async function listAllProperties(): Promise<PropertyRead[]> {
  const properties: PropertyRead[] = [];
  for (;;) {
    const page = await listProperties(properties.length);
    properties.push(...page.items);
    if (page.items.length === 0 || properties.length >= page.total) return properties;
  }
}

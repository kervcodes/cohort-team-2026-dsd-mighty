import type { EntityStatus } from "./entity";
export type PropertyStatus = EntityStatus;

export type Property = {
  property_id: string;
  property_name: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  status: PropertyStatus;
  created_at: string;
};

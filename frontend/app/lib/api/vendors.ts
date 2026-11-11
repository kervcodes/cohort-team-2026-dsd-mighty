import { apiRequest } from "./http";

// Mirrors backend/src/backend/schemas/common.py PaymentMethod.
export const paymentMethods = ["check", "ach", "wire", "credit_card", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  check: "Check",
  ach: "ACH",
  wire: "Wire",
  credit_card: "Credit card",
  other: "Other",
};

// Body of POST /vendors (backend VendorCreate). Optional keys are omitted, not
// sent empty: the backend rejects "" as an email.
export type VendorCreatePayload = {
  name: string;
  contact_email?: string;
  contact_phone?: string;
  default_payment_method?: PaymentMethod;
};

// Backend VendorRead.
export type Vendor = {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  default_payment_method: PaymentMethod | null;
  created_at: string;
};

export function listVendors(): Promise<Vendor[]> {
  return apiRequest<Vendor[]>(
    "/vendors",
    { method: "GET" },
    { signedOut: "You must be signed in to view vendors.", failed: "Unable to load vendors" },
  );
}

export function createVendor(payload: VendorCreatePayload): Promise<Vendor> {
  return apiRequest<Vendor>(
    "/vendors",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { signedOut: "You must be signed in to add a vendor.", failed: "Unable to add the vendor" },
  );
}

import type { PaymentMethod } from "@/lib/api/vendors";
import type { EntityStatus } from "./entity";

// Backend VendorAccountRead. The portal password is write-only: the API only
// says whether one is stored.
export type VendorAccount = {
  id: string;
  property_id: string;
  vendor_id: string;
  account_number: string;
  account_type: string;
  payment_method: PaymentMethod;
  portal_url: string | null;
  portal_login_email: string | null;
  portal_password_set: boolean;
  status: EntityStatus;
  created_at: string;
};

// Body of POST /vendor-accounts (backend VendorAccountCreate). Optional keys
// are omitted, not sent empty: the backend rejects "" as a URL, an email or a
// password.
export type VendorAccountCreatePayload = {
  vendor_id: string;
  property_id: string;
  account_number: string;
  account_type: string;
  payment_method: PaymentMethod;
  portal_url?: string;
  portal_login_email?: string;
  portal_password?: string;
};

// Body of PATCH /vendor-accounts/:id (backend VendorAccountUpdate). An omitted
// key keeps the stored value and null clears it. For `portal_password`:
// omitted keeps the password, null removes it, a value replaces it.
export type VendorAccountUpdatePayload = {
  account_number?: string;
  account_type?: string;
  payment_method?: PaymentMethod;
  portal_url?: string | null;
  portal_login_email?: string | null;
  portal_password?: string | null;
};

import { z } from "zod";
import { type PaymentMethod, paymentMethods } from "@/lib/api/vendors";
import type {
  VendorAccount,
  VendorAccountCreatePayload,
  VendorAccountUpdatePayload,
} from "@/types/vendor-account";

// The backend accepts http and https addresses only (pydantic HttpUrl).
function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

// Limits mirror backend/src/backend/schemas/vendor_account.py so the user sees
// the error inline instead of as a 422 from the API.
export const vendorAccountFormSchema = z.object({
  propertyId: z.string().min(1, "Choose a property"),
  accountNumber: z
    .string()
    .trim()
    .min(1, "Account number is required")
    .max(100, "Use 100 characters or fewer"),
  accountType: z
    .string()
    .trim()
    .min(1, "Account type is required")
    .max(50, "Use 50 characters or fewer"),
  paymentMethod: z.enum(["", ...paymentMethods]).refine((v) => v !== "", "Choose a payment method"),
  portalUrl: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || isWebAddress(v),
      "Enter the full address, like https://portal.example.com",
    ),
  portalLoginEmail: z
    .string()
    .trim()
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address"),
  // Not trimmed: spaces can be part of a password.
  portalPassword: z.string().max(200, "Use 200 characters or fewer"),
});

// What the fields hold, and what a valid form submits: the payment method can
// be "" while editing but never once validated.
export type VendorAccountFormInput = z.input<typeof vendorAccountFormSchema>;
export type VendorAccountFormValues = z.output<typeof vendorAccountFormSchema>;

// The password field always starts empty: the API never returns a password.
export function vendorAccountDefaults(
  account: VendorAccount | null,
  vendorPaymentMethod: PaymentMethod | null,
): VendorAccountFormInput {
  return {
    propertyId: account?.property_id ?? "",
    accountNumber: account?.account_number ?? "",
    accountType: account?.account_type ?? "",
    paymentMethod: account?.payment_method ?? vendorPaymentMethod ?? "",
    portalUrl: account?.portal_url ?? "",
    portalLoginEmail: account?.portal_login_email ?? "",
    portalPassword: "",
  };
}

// Empty optional fields are left out, not sent as "".
export function toCreatePayload(
  vendorId: string,
  values: VendorAccountFormValues,
): VendorAccountCreatePayload {
  const payload: VendorAccountCreatePayload = {
    vendor_id: vendorId,
    property_id: values.propertyId,
    account_number: values.accountNumber,
    account_type: values.accountType,
    payment_method: values.paymentMethod,
  };
  if (values.portalUrl) payload.portal_url = values.portalUrl;
  if (values.portalLoginEmail) payload.portal_login_email = values.portalLoginEmail;
  if (values.portalPassword) payload.portal_password = values.portalPassword;
  return payload;
}

// An emptied portal address or email is cleared (null). The password is left
// out when blank, so the stored one stays; `removePassword` sends null.
// The property cannot change: the backend's update takes no property_id.
export function toUpdatePayload(
  values: VendorAccountFormValues,
  removePassword: boolean,
): VendorAccountUpdatePayload {
  const payload: VendorAccountUpdatePayload = {
    account_number: values.accountNumber,
    account_type: values.accountType,
    payment_method: values.paymentMethod,
    portal_url: values.portalUrl || null,
    portal_login_email: values.portalLoginEmail || null,
  };
  if (removePassword) payload.portal_password = null;
  else if (values.portalPassword) payload.portal_password = values.portalPassword;
  return payload;
}

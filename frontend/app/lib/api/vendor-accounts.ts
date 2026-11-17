import type {
  VendorAccount,
  VendorAccountCreatePayload,
  VendorAccountUpdatePayload,
} from "@/types/vendor-account";
import { apiRequest } from "./http";

const JSON_HEADERS = { "Content-Type": "application/json" };

export function listVendorAccounts(vendorId: string): Promise<VendorAccount[]> {
  return apiRequest<VendorAccount[]>(
    `/vendors/${encodeURIComponent(vendorId)}/accounts`,
    { method: "GET" },
    {
      signedOut: "You must be signed in to view vendor accounts.",
      failed: "Unable to load the vendor's accounts",
    },
  );
}

export function createVendorAccount(payload: VendorAccountCreatePayload): Promise<VendorAccount> {
  return apiRequest<VendorAccount>(
    "/vendor-accounts",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) },
    {
      signedOut: "You must be signed in to add an account.",
      failed: "Unable to add the account",
    },
  );
}

export function updateVendorAccount(
  accountId: string,
  payload: VendorAccountUpdatePayload,
): Promise<VendorAccount> {
  return apiRequest<VendorAccount>(
    `/vendor-accounts/${encodeURIComponent(accountId)}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(payload) },
    {
      signedOut: "You must be signed in to change an account.",
      failed: "Unable to save the account",
    },
  );
}

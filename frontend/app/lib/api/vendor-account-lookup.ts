import type { VendorAccountOption } from "@/types/vendor-account-lookup";
import { apiRequest } from "./http";

// The active vendor accounts, by vendor name then account number. With
// `accountNumber`, only the accounts a bill with that number matches: the
// server compares the numbers the way it matches bills.
export function lookUpVendorAccounts(
  accountNumber?: string,
  signal?: AbortSignal,
): Promise<VendorAccountOption[]> {
  const query =
    accountNumber === undefined ? "" : `?${new URLSearchParams({ account_number: accountNumber })}`;

  return apiRequest<VendorAccountOption[]>(
    `/vendor-accounts${query}`,
    { method: "GET", cache: "no-store", signal },
    {
      signedOut: "You must be signed in to look up vendor accounts.",
      failed: "Unable to look up vendor accounts",
    },
  );
}

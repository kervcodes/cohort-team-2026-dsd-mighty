import type { AutopaySettings, AutopaySettingsUpdate } from "@/types/autopay";
import { apiRequest } from "./http";

// The autopay setting. Approvers and admins may read it.
export function getAutopaySettings(): Promise<AutopaySettings> {
  return apiRequest<AutopaySettings>(
    "/autopay-settings",
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to view autopay.",
      failed: "Unable to load autopay",
    },
  );
}

// Saves the setting (admins only). Fails with an ApiError of 422 when
// autopay is turned on without a limit above $0.
export function updateAutopaySettings(update: AutopaySettingsUpdate): Promise<AutopaySettings> {
  return apiRequest<AutopaySettings>(
    "/autopay-settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    },
    {
      signedOut: "You must be signed in to change autopay.",
      failed: "Unable to save autopay",
    },
  );
}

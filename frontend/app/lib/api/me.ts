import type { Profile } from "@/types/user";
import { apiRequest } from "./http";

export function getMe(): Promise<Profile> {
  return apiRequest<Profile>(
    "/me",
    { method: "GET", cache: "no-store" },
    {
      signedOut: "You must be signed in to load your account.",
      failed: "Unable to load your account",
    },
  );
}

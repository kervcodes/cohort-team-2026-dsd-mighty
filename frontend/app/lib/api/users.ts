import type { ApiProfile } from "@/types/user";
import { apiRequest } from "./http";

function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is missing. Check .env.local");
  }
  return url;
}

export function listUsers(): Promise<ApiProfile[]> {
  return apiRequest<ApiProfile[]>(
    "/admin/users",
    { method: "GET" },
    {
      signedOut: "You must be signed in to view users.",
      failed: "Unable to load users",
    },
  );
}

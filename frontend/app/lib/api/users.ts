import type { ApiProfile, UserRole } from "@/types/user";
import type { EntityStatus } from "@/types/entity";
import { apiRequest } from "./http";

function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;

  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is missing. Check .env.local");
  }

  return url;
}

export type UserUpdatePayload = {
  role?: UserRole;
  status?: EntityStatus;
};

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

export function getUser(user_id: string): Promise<ApiProfile> {
  return apiRequest<ApiProfile>(
    `/admin/users/${user_id}`,
    { method: "GET" },
    {
      signedOut: "You must be signed in to view users.",
      failed: "Unable to load user",
    },
  );
}

export function updateUser(
  user_id: string,
  payload: UserUpdatePayload,
): Promise<ApiProfile> {
  return apiRequest<ApiProfile>(
    `/admin/users/${user_id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    {
      signedOut: "You must be signed in to update users.",
      failed: "Unable to update user",
    },
  );
}

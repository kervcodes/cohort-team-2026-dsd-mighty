import type { EntityStatus } from "./entity";
export type UserRole = "admin" | "analyst" | "approver";
export type UserStatus = EntityStatus;

// The signed-in user's profile, exactly as `GET /me` returns it.
export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

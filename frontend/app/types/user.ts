import type { EntityStatus } from "./entity";
export type UserRole = "admin" | "analyst" | "approver";
export type UserStatus = EntityStatus;

export type Profile = {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

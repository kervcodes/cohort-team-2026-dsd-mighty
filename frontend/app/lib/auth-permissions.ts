import type { UserRole } from "@/types/user";

type RoutePermission = {
  path: string;
  roles: UserRole[];
};

const ROUTE_PERMISSIONS: RoutePermission[] = [
  // Shared routes
  { path: "/", roles: ["analyst", "approver"] },
  { path: "/dashboard", roles: ["analyst", "approver"] },
  { path: "/properties", roles: ["analyst", "approver"] },
  { path: "/vendors", roles: ["analyst", "approver"] },
  { path: "/invoices", roles: ["analyst", "approver"] },

  // Analyst routes
  { path: "/invoices/new", roles: ["analyst"] },
  { path: "/invoices/drafts", roles: ["analyst"] },

  // Approver routes
  { path: "/approvals", roles: ["approver"] },
];

export function canAccessRoute(pathname: string, role: UserRole): boolean {
  if (role === "admin") return true;

  const permission = ROUTE_PERMISSIONS.filter(
    ({ path }) => pathname === path || pathname.startsWith(`${path}/`),
  ).sort((a, b) => b.path.length - a.path.length)[0];

  return permission?.roles.includes(role) ?? false;
}

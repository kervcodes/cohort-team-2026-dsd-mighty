"use client";
import Link from "next/link";
import {
  LuBuilding2,
  LuFilePenLine,
  LuFilePlus,
  LuFileText,
  LuHouse,
  LuLayoutDashboard,
  LuLogOut,
  LuMoon,
  LuSettings,
  LuSun,
  LuUserRoundCog,
  LuUsers,
} from "react-icons/lu";
import { useAuth } from "@/auth/AuthProvider";
import { useSignOut } from "@/auth/useSignOut";
import { useTheme } from "@/context/ThemeContext";
import type { UserRole } from "@/types/user";

const COPY = {
  home: "Home",
  invoices: "Invoices",
  savedDrafts: "Saved Drafts",
  newInvoice: "New Invoice",
  properties: "Properties",
  vendors: "Vendors",
  adminDashboard: "Admin Dashboard",
  users: "Users",
  settings: "Settings",
  darkMode: "Dark Mode",
  lightMode: "Light Mode",
  switchToDark: "Switch to dark mode",
  switchToLight: "Switch to light mode",
  signOut: "Sign Out",
  signOutFailed: "Couldn't sign out. Try again.",
  roles: {
    admin: "Admin",
    analyst: "Analyst",
    approver: "Approver",
  } satisfies Record<UserRole, string>,
};

// Links and buttons share one shape so every icon lines up in one column.
const ITEM =
  "flex w-full items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-surface-muted [&>svg]:shrink-0";
const FOOTER_ITEM = `${ITEM} text-foreground-muted hover:text-foreground`;

export default function Sidebar() {
  const { user, profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { signOut, signingOut, signOutFailed } = useSignOut();
  const isAdmin = profile?.role === "admin";
  const email = profile?.email ?? user?.email;
  const themeLabel = theme === "light" ? COPY.switchToDark : COPY.switchToLight;

  return (
    <nav>
      <div className="fixed h-full w-8 sm:w-36 border-r border-border bg-surface text-foreground sm:px-2 py-8 flex flex-col justify-between">
        <ul className="space-y-1">
          <li>
            <Link title={COPY.home} href={isAdmin ? "/admin" : "/"} className={ITEM}>
              <LuHouse size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.home}</span>
            </Link>
          </li>

          <li>
            <Link title={COPY.invoices} href="/dashboard" className={ITEM}>
              <LuFileText size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.invoices}</span>
            </Link>
          </li>

          <li>
            <Link title={COPY.savedDrafts} href="/invoices/drafts" className={ITEM}>
              <LuFilePenLine size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.savedDrafts}</span>
            </Link>
          </li>

          <li>
            <Link title={COPY.newInvoice} href="/invoices/new" className={ITEM}>
              <LuFilePlus size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.newInvoice}</span>
            </Link>
          </li>

          <li>
            <Link title={COPY.properties} href="/properties" className={ITEM}>
              <LuBuilding2 size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.properties}</span>
            </Link>
          </li>

          <li>
            <Link title={COPY.vendors} href="/vendors" className={ITEM}>
              <LuUsers size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.vendors}</span>
            </Link>
          </li>
          {isAdmin && (
            <>
              <li>
                <Link title={COPY.adminDashboard} href="/admin" className={ITEM}>
                  <LuLayoutDashboard size={20} aria-hidden="true" />
                  <span className="hidden sm:block">{COPY.adminDashboard}</span>
                </Link>
              </li>

              <li>
                <Link title={COPY.users} href="/admin/users" className={ITEM}>
                  <LuUserRoundCog size={20} aria-hidden="true" />
                  <span className="hidden sm:block">{COPY.users}</span>
                </Link>
              </li>
            </>
          )}
        </ul>
        <ul className="space-y-1">
          {user && (
            <li className="hidden sm:block px-1 pb-2">
              {profile && (
                <>
                  <p
                    className="truncate text-sm font-medium text-foreground"
                    title={profile.full_name}
                  >
                    {profile.full_name}
                  </p>
                  <p className="text-xs text-foreground-muted">{COPY.roles[profile.role]}</p>
                </>
              )}
              <p className="truncate text-xs text-foreground-muted" title={email}>
                {email}
              </p>
            </li>
          )}

          <li>
            <button
              type="button"
              onClick={toggleTheme}
              title={themeLabel}
              aria-label={themeLabel}
              className={`${FOOTER_ITEM} cursor-pointer`}
            >
              {theme === "light" ? (
                <LuMoon size={20} aria-hidden="true" />
              ) : (
                <LuSun size={20} aria-hidden="true" />
              )}
              <span className="hidden sm:block">
                {theme === "light" ? COPY.darkMode : COPY.lightMode}
              </span>
            </button>
          </li>
          <li>
            <Link title={COPY.settings} href="/settings" className={FOOTER_ITEM}>
              <LuSettings size={20} aria-hidden="true" />
              <span className="hidden sm:block">{COPY.settings}</span>
            </Link>
          </li>

          {user && (
            <li>
              <button
                type="button"
                onClick={signOut}
                title={COPY.signOut}
                aria-label={COPY.signOut}
                disabled={signingOut}
                aria-busy={signingOut}
                className={`${FOOTER_ITEM} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <LuLogOut size={20} aria-hidden="true" />
                <span className="hidden sm:block">{COPY.signOut}</span>
              </button>
              {signOutFailed && (
                <p role="alert" className="sr-only sm:not-sr-only px-1 pt-1 text-xs text-overdue">
                  {COPY.signOutFailed}
                </p>
              )}
            </li>
          )}
        </ul>
      </div>
    </nav>
  );
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  LuBuilding2,
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
import { useTheme } from "@/context/ThemeContext";
import { createClient } from "@/lib/supabase/client";

const COPY = {
  signOut: "Sign Out",
  signOutFailed: "Couldn't sign out. Try again.",
};

export default function Sidebar() {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const signingOutRef = useRef(false);
  const router = useRouter();
  const { user, profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = profile?.role === "admin";

  // invoices
  //invoices/new
  // /admin/
  // /admin/users
  /// vendors
  ///properties
  //login/

  const signout = async () => {
    // A ref, not state, so a second click before React re-renders still sees the lock.
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    setSignOutFailed(false);

    try {
      // On a failed server call auth-js still clears the local session in most cases.
      const { error } = await createClient().auth.signOut();
      if (error) console.error("Sign out error:", error);

      router.replace("/login");
      router.refresh();
    } catch (err) {
      // Thrown before the session was cleared: stay here so the user can retry.
      console.error("Unexpected sign out error:", err);
      setSignOutFailed(true);
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  };

  return (
    <>
      <nav>
        <div className="fixed h-full w-8 sm:w-36 border-r border-border bg-surface text-foreground px-1 sm:pl-3 sm:pr-2 py-8 flex flex-col justify-between">
          <ul className="space-y-1">
            <li>
              <Link
                title="Home"
                href={isAdmin ? "/admin" : "/"}
                className="flex items-center gap-2"
              >
                <LuHouse size={20} aria-hidden="true" />
                <span className="hidden sm:block">Home</span>
              </Link>
            </li>

            <li>
              <Link title="Invoices" href="/dashboard" className="flex items-center gap-2">
                <LuFileText size={20} aria-hidden="true" />
                <span className="hidden sm:block">Invoices</span>
              </Link>
            </li>

            <li>
              <Link title="New Invoice" href="/invoices/new" className="flex items-center gap-2">
                <LuFilePlus size={20} aria-hidden="true" />
                <span className="hidden sm:block">New Invoice</span>
              </Link>
            </li>

            <li>
              <Link title="Properties" href="/properties" className="flex items-center gap-2">
                <LuBuilding2 size={20} aria-hidden="true" />
                <span className="hidden sm:block">Properties</span>
              </Link>
            </li>

            <li>
              <Link title="Vendors" href="/vendors" className="flex items-center gap-2">
                <LuUsers size={20} aria-hidden="true" />
                <span className="hidden sm:block">Vendors</span>
              </Link>
            </li>
            {isAdmin && (
              <>
                <li>
                  <Link title="Admin Dashboard" href="/admin" className="flex items-center gap-2">
                    <LuLayoutDashboard size={20} aria-hidden="true" />
                    <span className="hidden sm:block">Admin Dashboard</span>
                  </Link>
                </li>

                <li>
                  <Link title="Users" href="/admin/users" className="flex items-center gap-2">
                    <LuUserRoundCog size={20} aria-hidden="true" />
                    <span className="hidden sm:block">Users</span>
                  </Link>
                </li>
              </>
            )}
          </ul>
          <ul className="space-y-1">
            <li className="capitalize hidden sm:block px-1 pb-2 text-foreground-muted">
              {user?.email}
            </li>

            <li>
              <button
                onClick={toggleTheme}
                title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-foreground-muted hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer"
              >
                {theme === "light" ? (
                  <LuMoon size={20} aria-hidden="true" />
                ) : (
                  <LuSun size={20} aria-hidden="true" />
                )}
                <span className="hidden sm:block">
                  {theme === "light" ? "Dark Mode" : "Light Mode"}
                </span>
              </button>
            </li>
            <li>
              <Link title="Settings" href="/settings" className="flex items-center gap-2">
                <LuSettings size={20} aria-hidden="true" />
                <span className="hidden sm:block">Settings</span>
              </Link>
            </li>

            {user && (
              <li>
                <button
                  type="button"
                  onClick={signout}
                  title={COPY.signOut}
                  aria-label={COPY.signOut}
                  disabled={signingOut}
                  aria-busy={signingOut}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-foreground-muted hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
    </>
  );
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { useTheme } from "@/context/ThemeContext";

export default function Sidebar() {
  // for testing
  // in production get user session and if admin
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  // invoices
  //invoices/new
  // /admin/
  // /admin/users
  /// vendors
  ///properties
  //login/

  const signout = () => {
    setIsLoggedIn(false);
    setIsAdmin(false);
    router.push("/login");
  };
  const signin = () => {
    setIsLoggedIn(true);
    router.push("/");
  };

  const toggleAdmin = () => {
    setIsAdmin((prev) => !prev);
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
          {/* Control panel sued for testing btwn signed in users and admin while auth is still being setup*/}
          {/* Control Panel area will be deleted once auth is set up  */}
          <ul className="text-sm text-foreground-muted">
            <li className="font-medium text-foreground">Control Panel</li>
            {!isLoggedIn && (
              <li>
                <button onClick={signin} className="hover:text-foreground cursor-pointer">
                  Log in
                </button>
              </li>
            )}
            <li>{isAdmin ? "is admin" : "is analyst"}</li>
            <li>
              <button className="hover:text-foreground cursor-pointer" onClick={toggleAdmin}>
                toggle admin
              </button>
            </li>
          </ul>
          <ul className="space-y-1">
            {isLoggedIn && (
              <li className="capitalize hidden sm:block px-1 pb-2 text-foreground-muted">
                username
              </li>
            )}
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

            {isLoggedIn && (
              <li>
                <button
                  onClick={signout}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-foreground-muted hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <LuLogOut size={20} aria-hidden="true" />
                  <span className="hidden sm:block">Sign Out</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      </nav>
    </>
  );
}

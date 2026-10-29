"use client";
import {
  LuHouse,
  LuFileText,
  LuFilePlus,
  LuBuilding2,
  LuUsers,
  LuLayoutDashboard,
  LuUserRoundCog,
  LuSettings,
  LuLogOut,
} from "react-icons/lu";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Sidebar() {
  // for testing
  // in production get user session and if admin
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

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
        <div
          style={{
            backgroundColor: "var(--foreground)",
            color: "var(--background)",
          }}
          className="fixed h-full w-8 sm:w-36 border px-1 sm:pl-4 py-8  flex flex-col justify-between bg-dark"
        >
          <ul className="space-y-4">
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
              <Link
                title="Invoices"
                href="/dashboard"
                className="flex items-center gap-2"
              >
                <LuFileText size={20} aria-hidden="true" />
                <span className="hidden sm:block">Invoices</span>
              </Link>
            </li>

            <li>
              <Link
                title="New Invoice"
                href="/invoices/new"
                className="flex items-center gap-2"
              >
                <LuFilePlus size={20} aria-hidden="true" />
                <span className="hidden sm:block">New Invoice</span>
              </Link>
            </li>

            <li>
              <Link
                title="Properties"
                href="/properties"
                className="flex items-center gap-2"
              >
                <LuBuilding2 size={20} aria-hidden="true" />
                <span className="hidden sm:block">Properties</span>
              </Link>
            </li>

            <li>
              <Link
                title="Vendors"
                href="/vendors"
                className="flex items-center gap-2"
              >
                <LuUsers size={20} aria-hidden="true" />
                <span className="hidden sm:block">Vendors</span>
              </Link>
            </li>
            {isAdmin && (
              <>
                <li>
                  <Link
                    title="Admin Dashboard"
                    href="/admin"
                    className="flex items-center gap-2"
                  >
                    <LuLayoutDashboard size={20} aria-hidden="true" />
                    <span className="hidden sm:block">Admin Dashboard</span>
                  </Link>
                </li>

                <li>
                  <Link
                    title="Users"
                    href="/admin/users"
                    className="flex items-center gap-2"
                  >
                    <LuUserRoundCog size={20} aria-hidden="true" />
                    <span className="hidden sm:block">Users</span>
                  </Link>
                </li>
              </>
            )}
          </ul>
          {/* Control panel sued for testing btwn signed in users and admin while auth is still being setup*/}
          {/* Control Panel area will be deleted once auth is set up  */}
          <ul>
            <li>Control Panel</li>
            {!isLoggedIn && (
              <li>
                <button onClick={signin}>Log in</button>
              </li>
            )}
            <li>{isAdmin ? "is admin" : "is analyst"}</li>
            <li>
              <button className="cursor-pointer" onClick={toggleAdmin}>
                toggle admin
              </button>
            </li>
          </ul>
          <ul className="space-y-4">
            {isLoggedIn && (
              <li className="capitalize hidden sm:block">username</li>
            )}
            <li>
              <Link
                title="Settings"
                href="/settings"
                className="flex items-center gap-2"
              >
                <LuSettings size={20} aria-hidden="true" />
                <span className="hidden sm:block">Settings</span>
              </Link>
            </li>

            {isLoggedIn && (
              <li>
                <button onClick={signout} className="flex items-center gap-2">
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

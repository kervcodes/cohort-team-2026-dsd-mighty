"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const COPY = {
  title: "Admin",
};

const tabs = [
  { label: "Rules", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Audit log", href: "/admin/audit" },
];

export default function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isEditPage = pathname.includes("/edit");

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:p-8">
      <h1 className="mb-8 text-3xl font-semibold text-foreground">{COPY.title}</h1>

      <div className="rounded-lg border border-border bg-surface">
        <nav className="flex gap-4 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-border)] sm:gap-6">
          {tabs.map((tab) => {
            const active =
              !isEditPage &&
              (tab.href === "/admin" ? pathname === tab.href : pathname === tab.href);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 py-3 text-xl transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
          {isEditPage && (
            <p
              aria-current="page"
              className="border-b-2 py-3 text-xl transition-colors border-primary text-foreground"
            >
              {" "}
              Edit
            </p>
          )}
        </nav>

        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </main>
  );
}

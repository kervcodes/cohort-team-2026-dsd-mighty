"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const COPY = {
  title: "Admin",
};

const tabs = [
  { label: "Rules", href: "/admin" },
  { label: "Users", href: "/admin/users" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <main className="mx-auto max-w-5xl py-8">
      <h1 className="mb-8 text-3xl font-semibold text-foreground">{COPY.title}</h1>

      <div className="rounded-lg border border-border bg-surface">
        <nav className="flex gap-6 border-b border-border px-4">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px border-b-2 py-3 text-xl transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-6">{children}</div>
      </div>
    </main>
  );
}

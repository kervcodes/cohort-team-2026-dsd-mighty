"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/DataTable/DataTable";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { listUsers } from "@/lib/api/users";
import type { ApiProfile } from "@/types/user";

const COPY = {
  sectionTitle: "All Users",
  loading: "Loading profiles...",
  empty: "No profiles yet.",
  loadFailed: "Unable to load profiles.",
  notSet: "—",
  auth_loading: "loading permissions...",
  auth_error: "Your role does not have access",
};
const columns: DataTableColumn<ApiProfile>[] = [
  {
    header: "id",
    cell: (profile) => (
      <Link
        className="text-blue-600 hover:underline"
        href={`/admin/users/${profile.user_id}/edit`}
      >
        {profile.user_id.slice(0, 8)}{" "}
      </Link>
    ),
  },
  { header: "Name", cell: (profile) => profile.full_name ?? COPY.notSet },
  { header: "Email", cell: (profile) => profile.email ?? COPY.notSet },
  { header: "Role", cell: (profile) => profile.role ?? COPY.notSet },

  {
    header: "Status",
    cell: (profile) => <StatusBadge status={profile.status} />,
  },
];

export default function AdminUsersPage() {
  const { profile, loading: authLoading } = useAuth();

  const canViewUsers =
    !authLoading && profile?.role === "admin" && profile.status === "active";
  const [users, setUsers] = useState<ApiProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canViewUsers) return;

    let cancelled = false;

    listUsers()
      .then((result) => {
        if (cancelled) return;
        setUsers(
          result.map((user) => ({
            ...user,
            id: user.user_id,
          })),
        );
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : COPY.loadFailed);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, canViewUsers]);

  function retry() {
    setError(null);
    setAttempt((n) => n + 1);
  }
  if (authLoading) return <p>{COPY.auth_loading} </p>;
  if (!canViewUsers) return <p>{COPY.auth_error}</p>;
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-6 inline-block rounded bg-surface-muted px-3 py-1 text-xl font-medium text-foreground">
          {COPY.sectionTitle}
        </h2>
        <DataTable
          label={COPY.sectionTitle}
          columns={columns}
          rows={users ?? []}
          getRowKey={(profile) => profile.user_id}
          loading={users === null && error === null}
          loadingMessage={COPY.loading}
          error={error}
          onRetry={retry}
          emptyMessage={COPY.empty}
        />
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { getUser, updateUser } from "@/lib/api/users";
import type { ApiProfile } from "@/types/user";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";

const COPY = {
  title: "Edit User",
  back: "Back to Users",
  accountInfo: "Account Information",
  permissions: "Account Permissions",
  fullName: "Full Name",
  email: "Email Address",
  userId: "User ID",
  role: "Role",
  roleHint: "Determines which actions this user can perform.",
  status: "Account Status",
  statusHint: "Inactive users cannot access the application.",
  save: "Save Changes",
  cancel: "Cancel",
  loading: "Loading user...",
  notFound: "User not found.",
  loadFailed: "Unable to load user.",
  notSet: "-",
  confirmTitle: "Save User Permissions?",
  confirmLabel: "Save changes",
  confirmIntro: `This changes the user's permissions`,
  confirmSubmit: "Confirm Changes",
  saving: "Saving...",
};

const roles = [
  { value: "analyst", label: "Analyst" },
  { value: "approver", label: "Approver" },
  { value: "admin", label: "Admin" },
] as const;

const statuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const labelClass = "mb-1.5 block text-sm font-medium text-foreground";

export default function AdminUsersEditPage() {
  const params = useParams<{ user_id: string }>();
  const userId = params.user_id;

  const { profile, loading: authLoading } = useAuth();

  const canViewUsers =
    !authLoading && profile?.role === "admin" && profile.status === "active";

  const [user, setUser] = useState<ApiProfile | null>(null);
  const [role, setRole] = useState<ApiProfile["role"]>("analyst");
  const [status, setStatus] = useState<ApiProfile["status"]>("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleSaveClick = () => {
    setMessage(null);
    setConfirmOpen(true);
  };

  useEffect(() => {
    if (!canViewUsers) return;

    let cancelled = false;

    async function loadUser() {
      if (!canViewUsers) return;

      try {
        setLoading(true);
        setError(null);

        const result = await getUser(userId);

        if (cancelled) return;

        if (!result) {
          setUser(null);
          setError(COPY.notFound);
          return;
        }

        setUser(result);
        setRole(result.role);
        setStatus(result.status);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : COPY.loadFailed);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [userId, canViewUsers]);

  function handleCancel() {
    if (!user) return;
    setConfirmOpen(false);
    setRole(user.role);
    setStatus(user.status);
    setMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveUser();
  }

  async function saveUser() {
    if (!canViewUsers || !userId || !user || !hasChanges || loading) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setMessage(null);
      setSaving(true);
      const payload: {
        role?: ApiProfile["role"];
        status?: ApiProfile["status"];
      } = {};

      if (role !== user.role) {
        payload.role = role;
      }

      if (status !== user.status) {
        payload.status = status;
      }

      const result = await updateUser(userId, payload);

      setUser(result);
      setRole(result.role);
      setStatus(result.status);

      setMessage("User updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user.");
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    await saveUser();
  }

  const hasChanges =
    user !== null && (role !== user.role || status !== user.status);

  if (authLoading) {
    return <p role="status">Loading permissions...</p>;
  }

  if (!canViewUsers) {
    return <p role="alert">Your role does not have access.</p>;
  }
  if (loading && !saving) {
    return <p>{COPY.loading}</p>;
  }
  if (!user) {
    if (error) {
      return <p role="alert">{error}</p>;
    }

    return <p>{COPY.notFound}</p>;
  }
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground"
        >
          <span aria-hidden="true">&larr;</span>
          {COPY.back}
        </Link>

        <div>
          <h2 className="text-2xl font-semibold text-foreground">
            {COPY.title}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Manage account permissions and status.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-lg border border-border bg-surface p-6">
          <h3 className="mb-5 text-lg font-semibold text-foreground">
            {COPY.accountInfo}
          </h3>

          <dl className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-foreground-muted">{COPY.fullName}</dt>
              <dd className="mt-1 font-medium text-foreground">
                {user.full_name ?? COPY.notSet}
              </dd>
            </div>

            <div>
              <dt className="text-sm text-foreground-muted">{COPY.email}</dt>
              <dd className="mt-1 font-medium text-foreground">
                {user.email ?? COPY.notSet}
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-sm text-foreground-muted">{COPY.userId}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground">
                {user.user_id}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface p-6">
          <h3 className="mb-5 text-lg font-semibold text-foreground">
            {COPY.permissions}
          </h3>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="role" className={labelClass}>
                {COPY.role}
              </label>

              <select
                id="role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as ApiProfile["role"])
                }
                className={inputClass}
              >
                {roles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <p className="mt-2 text-xs text-foreground-muted">
                {COPY.roleHint}
              </p>
            </div>

            <div>
              <label htmlFor="status" className={labelClass}>
                {COPY.status}
              </label>

              <select
                id="status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ApiProfile["status"])
                }
                className={inputClass}
              >
                {statuses.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <p className="mt-2 text-xs text-foreground-muted">
                {COPY.statusHint}
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-3 ">
          <div className="flex gap-3 flex-col-reverse sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!hasChanges}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {COPY.cancel}
            </button>

            <button
              type="button"
              onClick={handleSaveClick}
              disabled={!hasChanges}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : COPY.save}
            </button>
            <ConfirmModal
              open={confirmOpen}
              title={COPY.confirmTitle}
              confirmLabel={loading ? COPY.saving : COPY.confirmSubmit}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            >
              <p>{COPY.confirmIntro}</p>
              <ul className="mt-2 list-disc pl-5 text-foreground">
                {role !== user.role && (
                  <li>
                    <span className="line-through text-foreground-muted">
                      {" "}
                      {user.role}
                    </span>{" "}
                    -{">"} {role}
                  </li>
                )}
                {status !== user.status && (
                  <li>
                    <p>
                      <span className="line-through text-foreground-muted">
                        {" "}
                        {user.status}
                      </span>{" "}
                      -{">"} {status}
                    </p>
                  </li>
                )}
              </ul>
            </ConfirmModal>
          </div>

          {message && (
            <div className="flex justify-center">
              <p role="status" className="text-sm text-foreground-muted">
                {message}
              </p>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <p role="alert" className="text-sm text-overdue">
                {error}
              </p>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

"use client";

import type { IconType } from "react-icons";
import { LuCircleAlert, LuHourglass } from "react-icons/lu";
import Button from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import { useSignOut } from "./useSignOut";

const COPY = {
  waitingTitle: "Waiting for approval",
  waitingMessage:
    "Your account has been created. An admin needs to approve it before you can use the app. Check back later.",
  errorTitle: "We couldn't load your account",
  signedInAs: "Signed in as",
  tryAgain: "Try again",
  signOut: "Sign Out",
  signingOut: "Signing out...",
  signOutFailed: "Couldn't sign out. Try again.",
};

// Wraps the app shell (sidebar and pages). Once `GET /me` says a signed-in
// user is inactive, or their account could not be loaded, a full-page screen
// replaces the app. While the account loads the app still renders, so the
// server-rendered shell is never empty (Cache Components validates it); the
// backend refuses an inactive user's requests meanwhile.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, profile, profileError } = useAuth();

  if (user && profileError) {
    return (
      <AccountScreen
        icon={LuCircleAlert}
        iconClassName="bg-overdue-bg text-overdue"
        title={COPY.errorTitle}
        message={profileError}
        email={user.email}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (user && profile?.status === "inactive") {
    return (
      <AccountScreen
        icon={LuHourglass}
        iconClassName="bg-accent text-accent-foreground"
        title={COPY.waitingTitle}
        message={COPY.waitingMessage}
        email={profile.email}
      />
    );
  }

  return children;
}

function AccountScreen({
  icon: Icon,
  iconClassName,
  title,
  message,
  email,
  onRetry,
}: {
  icon: IconType;
  iconClassName: string;
  title: string;
  message: string;
  email?: string;
  onRetry?: () => void;
}) {
  const { signOut, signingOut, signOutFailed } = useSignOut();

  return (
    <main className="col-span-full flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <div
          className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${iconClassName}`}
        >
          <Icon size={24} aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-foreground-muted">{message}</p>
        {email && (
          <p className="mt-4 text-sm text-foreground-muted">
            {COPY.signedInAs}
            <span className="block wrap-break-word font-medium text-foreground">{email}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {onRetry && <Button label={COPY.tryAgain} onClick={onRetry} />}
          <Button
            label={signingOut ? COPY.signingOut : COPY.signOut}
            variant={onRetry ? "secondary" : "primary"}
            onClick={signOut}
            disabled={signingOut}
            aria-busy={signingOut}
          />
        </div>
        {signOutFailed && (
          <p role="alert" className="mt-3 text-sm text-overdue">
            {COPY.signOutFailed}
          </p>
        )}
      </div>
    </main>
  );
}

"use client";

import type { IconType } from "react-icons";
import { LuCircleAlert, LuHourglass, LuLoaderCircle } from "react-icons/lu";
import Button from "@/components/Button";
import { useAuth } from "./AuthProvider";
import { useSignOut } from "./useSignOut";

const COPY = {
  loading: "Loading your account...",
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

// Wraps the app shell (sidebar and pages); the proxy has already sent signed-out
// visitors to /login. Until `GET /me` answers, a loading screen stands in for the
// app, so an inactive user never sees any of it. AuthProvider starts out loading,
// so the server render and the first client render both show that screen: no
// flash of the app. Then an inactive user, or one whose account could not be
// loaded, gets a full-page screen in place of the app.
//
// The app still renders behind any screen, hidden: Next needs every page in the
// server render to validate its navigation (Cache Components; a hidden Activity
// is left out of the server render, so it does not work here). A hidden page may
// already send its requests; the backend refuses an inactive user's, and nothing
// of the page is shown. Once the account is active the page is revealed, not
// remounted.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const screen = useAccountScreen();

  return (
    <>
      {screen}
      <div hidden={Boolean(screen)} className="contents">
        {children}
      </div>
    </>
  );
}

// The full-page screen to show instead of the app, or null for an active user.
// A signed-out user only gets null for a moment after signing out, while
// useSignOut takes them to /login.
function useAccountScreen(): React.ReactNode {
  const { user, profile, profileError, loading } = useAuth();

  if (loading) return <LoadingScreen />;

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

  return null;
}

// The card every full-page account screen shares.
function ScreenCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="col-span-full flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        {children}
      </div>
    </main>
  );
}

function ScreenIcon({
  icon: Icon,
  className,
  spin = false,
}: {
  icon: IconType;
  className: string;
  spin?: boolean;
}) {
  return (
    <div
      className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${className}`}
    >
      <Icon
        size={24}
        aria-hidden="true"
        className={spin ? "motion-safe:animate-spin" : undefined}
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <ScreenCard>
      <div role="status">
        <ScreenIcon icon={LuLoaderCircle} className="bg-accent text-accent-foreground" spin />
        <p className="text-sm text-foreground-muted">{COPY.loading}</p>
      </div>
    </ScreenCard>
  );
}

function AccountScreen({
  icon,
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
    <ScreenCard>
      <ScreenIcon icon={icon} className={iconClassName} />
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
    </ScreenCard>
  );
}

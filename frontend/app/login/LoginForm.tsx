"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/button";
import { login as content } from "@/content";
import { createClient } from "@/lib/supabase/client";

const CALLBACK_ERROR_MESSAGE =
  "We couldn't finish confirming your email. The link may have expired or been opened in a different browser. Your email may already be confirmed, so try logging in below.";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedEmail = email.trim().toLowerCase();

  // Only the exact known value is honored; the raw param is never rendered.
  const callbackError =
    searchParams.get("error") === "auth_callback_failed" ? CALLBACK_ERROR_MESSAGE : null;

  // A login error replaces the callback message; hide it while a submit is in flight.
  const message = error ?? (loading ? null : callbackError);

  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();

    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("Login error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Lock className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {content.heading}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">{content.subheading}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border bg-surface p-8 shadow-sm"
        >
          {message && (
            <div
              role="alert"
              className="rounded-lg border border-overdue/30 bg-overdue-bg p-3 text-sm text-overdue"
            >
              {message}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              {content.email}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder={content.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              {content.password}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder={content.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 pr-10 text-sm text-foreground placeholder:text-foreground-muted transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-foreground-muted transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-lg"
                aria-label={showPassword ? content.hidePassword : content.showPassword}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full py-2.5"
            label={loading ? content.submitting : content.submit}
          />
        </form>

        <p className="mt-6 text-center text-sm text-foreground-muted">
          {content.noAccount}{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:text-primary-hover hover:underline"
          >
            {content.signupLink}
          </Link>
        </p>
      </div>
    </main>
  );
}

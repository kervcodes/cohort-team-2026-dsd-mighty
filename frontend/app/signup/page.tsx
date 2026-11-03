"use client";

import { Eye, EyeOff, Mail, UserPlus } from "lucide-react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/button";
import { signup as content } from "@/content";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();

  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    if (loading) return;

    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      if (data.session) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setCheckEmail(true);
    } catch (error) {
      console.error("Signup failed:", error);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checkEmail) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {content.checkEmail.heading}
          </h1>
          <p className="text-sm text-foreground-muted">
            {content.checkEmail.before}{" "}
            <strong className="wrap-break-word text-foreground">{email}</strong>
            {content.checkEmail.after}
          </p>
          <Link
            href="/login"
            className="inline-block text-sm font-medium text-primary hover:text-primary-hover hover:underline"
          >
            {content.checkEmail.back}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <UserPlus className="h-6 w-6" aria-hidden="true" />
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
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-overdue/30 bg-overdue-bg p-3 text-sm text-overdue"
            >
              {error}
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
                autoComplete="new-password"
                placeholder={content.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-muted py-2 pl-3 pr-10 text-sm text-foreground placeholder:text-foreground-muted transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-foreground-muted transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword ? content.hidePassword : content.showPassword}
              >
                {showPassword ? (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm" className="text-sm font-medium text-foreground">
              {content.confirmPassword}
            </label>
            <div className="relative">
              <input
                id="confirm"
                type={showConfirmPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                aria-invalid={confirm.length > 0 && password !== confirm}
                placeholder={content.confirmPlaceholder}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-muted py-2 pl-3 pr-10 text-sm text-foreground placeholder:text-foreground-muted transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-foreground-muted transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showConfirmPassword ? content.hidePassword : content.showPassword}
              >
                {showConfirmPassword ? (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full py-2.5"
            label={loading ? content.submitting : content.submit}
          />
        </form>

        <p className="mt-6 text-center text-sm text-foreground-muted">
          {content.haveAccount}{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:text-primary-hover hover:underline"
          >
            {content.loginLink}
          </Link>
        </p>
      </div>
    </main>
  );
}

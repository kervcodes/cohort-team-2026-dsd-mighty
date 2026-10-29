import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-overdue";

export type FieldControlProps = {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
};

type FormFieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
};

export function FormField({ label, htmlFor, error, hint, children }: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const control: FieldControlProps = {
    id: htmlFor,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {hint && (
          <span id={hintId} className="text-xs text-foreground-muted">
            {hint}
          </span>
        )}
      </div>

      {typeof children === "function" ? children(control) : children}

      {error && (
        <p id={errorId} className="text-xs text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}

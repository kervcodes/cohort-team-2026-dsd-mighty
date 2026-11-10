"use client";

import { useId, useState } from "react";
import { sanitizeCurrencyInput } from "@/lib/currency";

const COPY = {
  tooltipIcon: "?",
  edit: "edit",
  done: "done",
};

type Props = {
  label: string;
  tooltip: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  prefix?: string;
  currency?: boolean;
  inputMode?: "decimal" | "numeric";
};

function sanitizeWholeNumberInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

export default function RuleField({
  label,
  tooltip,
  value,
  onChange,
  error,
  hint,
  prefix,
  currency = false,
  inputMode = "decimal",
}: Props) {
  const [editing, setEditing] = useState(false);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const handleChange = (raw: string) => {
    onChange(currency ? sanitizeCurrencyInput(raw) : sanitizeWholeNumberInput(raw));
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-sm text-foreground">
        <label htmlFor={id}>{label}</label>
        <span
          title={tooltip}
          className="flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-border text-xs text-foreground-muted"
        >
          {COPY.tooltipIcon}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div
          className={`flex w-full max-w-sm items-center rounded border-2 px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring ${
            error ? "border-overdue" : "border-border"
          } ${editing ? "bg-surface" : "bg-surface-muted"}`}
        >
          {prefix && <span className="mr-1 text-foreground-muted">{prefix}</span>}
          <input
            id={id}
            type="text"
            inputMode={inputMode}
            value={value}
            disabled={!editing}
            onChange={(e) => handleChange(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className="w-full bg-transparent text-foreground outline-none disabled:text-foreground-muted"
          />
        </div>

        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="text-sm text-primary hover:text-primary-hover hover:underline"
        >
          {editing ? COPY.done : COPY.edit}
        </button>
      </div>

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-foreground-muted">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="mt-1 text-sm text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}

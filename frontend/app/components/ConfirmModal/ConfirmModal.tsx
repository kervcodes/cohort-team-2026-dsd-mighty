"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import Button from "@/components/ui/button";

const COPY = {
  cancel: "Cancel",
  confirm: "Confirm",
  closeDialog: "Close dialog",
};

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = COPY.confirm,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes the dialog
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  // Move focus into the dialog on open, and restore it on close
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={COPY.closeDialog}
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default rounded-none bg-black/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl focus:outline-none"
      >
        <h2 id={titleId} className="mb-3 text-xl font-semibold text-foreground">
          {title}
        </h2>
        <div className="mb-6 text-sm text-foreground-muted">{children}</div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {COPY.cancel}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

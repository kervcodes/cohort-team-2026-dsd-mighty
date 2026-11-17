import type { EntityStatus } from "@/types/entity";
import type { InvoiceStatus } from "@/types/invoice";
import type { PaymentRunStatus } from "@/types/payment-run";

type AllStatuses = InvoiceStatus | EntityStatus | PaymentRunStatus;

// The theme colour pairs in globals.css, so a badge follows light and dark
// mode. Each text colour is AA (4.5:1) on its background in both themes.
export const badgeTones = {
  neutral: "bg-pending-bg text-pending",
  info: "bg-info-bg text-info",
  accent: "bg-accent text-accent-foreground",
  success: "bg-paid-bg text-paid",
  warning: "bg-due-soon-bg text-due-soon",
  danger: "bg-overdue-bg text-overdue",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export const statusTones: Record<AllStatuses, BadgeTone> = {
  draft: "neutral",
  pending_approval: "info",
  approved: "accent",
  rejected: "danger",
  paid: "success",
  failed: "danger",
  exception: "warning",
  active: "success",
  inactive: "neutral",
  queued: "neutral",
  running: "info",
  flagged: "warning",
};

export function StatusBadge({ status }: { status: AllStatuses }) {
  const label = status.replaceAll("_", " ");

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${badgeTones[statusTones[status]]}`}
    >
      {label}
    </span>
  );
}

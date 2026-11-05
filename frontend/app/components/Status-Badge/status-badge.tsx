import type { EntityStatus } from "@/types/entity";
import type { InvoiceStatus } from "@/types/invoice";

type AllStatuses = InvoiceStatus | EntityStatus;

const styles: Record<AllStatuses, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  exception: "bg-orange-100 text-orange-800",
  active: "bg-green-100 text-green-800",
  inactive: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: AllStatuses }) {
  const label = status.replaceAll("_", " ");

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[status]}`}
    >
      {label}
    </span>
  );
}

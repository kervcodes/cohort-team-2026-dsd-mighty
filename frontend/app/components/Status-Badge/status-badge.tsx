import type { InvoiceStatus } from '../../types/invoice';

const styles: Record<InvoiceStatus, string> = {
  pending: 'bg-pending-bg text-pending',
  approved: 'bg-accent text-accent-foreground',
  paid: 'bg-paid-bg text-paid',
  overdue: 'bg-overdue-bg text-overdue',
};

type StatusBadgeProps = {
  status: InvoiceStatus;
};

export const StatusBadge = ({ status }: { status: InvoiceStatus }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
};

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { InvoiceTable } from '@/components/Invoice-table/invoice-table';
import { StatCard } from '@/components/Stat-card/stat-card';
import { Invoice } from '@/types/invoice';

//examples
const invoices: Invoice[] = [
  {
    id: 'INV-1013',
    property: 'Oak Terrace',
    company: 'Northgate LLC',
    dueDate: '2026-10-28',
    vendor: 'Rapid Plumbing & Rooter',
    amount: 1180.5,
    status: 'pending',
  },
  {
    id: 'INV-1011',
    property: 'Maple Court',
    company: 'Westside Holdings',
    dueDate: '2026-10-20',
    vendor: 'ProGuard Security',
    amount: 780.0,
    status: 'overdue',
  },
  {
    id: 'INV-1010',
    property: 'Harbor View',
    company: 'Bluebird Realty',
    dueDate: '2026-10-15',
    vendor: 'LADWP',
    amount: 1102.64,
    status: 'paid',
  },
];

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function sum(list: Invoice[]) {
  return list.reduce((total, inv) => total + inv.amount, 0);
}

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const now = new Date();
  const today = toISODate(now);
  const weekFromNow = toISODate(
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  );
  const thisMonth = today.slice(0, 7); // "YYYY-MM"

  const outstanding = invoices.filter((i) => i.status !== 'paid');
  const dueThisWeek = outstanding.filter(
    (i) => i.dueDate >= today && i.dueDate <= weekFromNow,
  );
  const paidThisMonth = invoices.filter(
    (i) => i.status === 'paid' && i.dueDate.startsWith(thisMonth),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Bill &amp; Invoice
        </h1>

        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" />
          New Invoice
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Outstanding"
          value={currency.format(sum(outstanding))}
          hint={`${outstanding.length} invoices`}
        />
        <StatCard
          label="Due this week"
          value={currency.format(sum(dueThisWeek))}
          hint={`${dueThisWeek.length} invoices`}
        />
        <StatCard
          label="Paid this month"
          value={currency.format(sum(paidThisMonth))}
          hint={`${paidThisMonth.length} invoices`}
        />
      </div>

      <InvoiceTable invoices={invoices} />
    </div>
  );
}

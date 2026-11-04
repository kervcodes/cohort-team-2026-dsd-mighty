import type { BillStatus } from "@/lib/api/bills";

export type InvoiceStatus = BillStatus;

export type Invoice = {
  id: string;
  property: string;
  company: string;
  dueDate: string | null;
  vendor: string;
  amount: number | null;
  status: InvoiceStatus;
  invoiceNumber?: string | null;
};

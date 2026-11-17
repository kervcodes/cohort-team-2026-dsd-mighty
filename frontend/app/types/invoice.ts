import type { BillStatus } from "@/types/bill";

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
  // Set when the bill's address names another property than its vendor
  // account's.
  propertyWarning?: string;
};

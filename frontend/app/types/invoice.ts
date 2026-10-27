export type InvoiceStatus = "pending" | "approved" | "paid" | "overdue";

export type Invoice = {
  id: string;
  property: string;
  company: string;
  dueDate: string;
  vendor: string;
  amount: number;
  status: InvoiceStatus;
};

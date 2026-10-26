export type InvoiceStatus = 'pending' | 'approved' | 'paid' | 'overdue';

export type AccountStatus = 'unpaid' | 'outstanding' | 'paid';

export type Invoice = {
  id: string;
  property: string;
  company: string;
  dueDate: string;
  vendor: string;
  amount: number;
  status: InvoiceStatus;
};

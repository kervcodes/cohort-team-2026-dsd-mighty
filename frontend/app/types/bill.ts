export type BillStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid"
  | "failed"
  | "exception";

export type AccountStatus = "unpaid" | "outstanding" | "paid";

export type BillCreatePayload = {
  account_number_raw: string;
  vendor_name_raw?: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  prev_payments?: string;
  description?: string;
  processing_notes?: string;
  property_address?: string;
  account_status?: AccountStatus;
  website_name?: string;
  // The vendor account the analyst picked. Omitted: the server matches the
  // account number, if exactly one active account has it.
  vendor_account_id?: string;
};

export type Bill = {
  id: string;
  account_number_raw: string;
  vendor_name_raw: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  prev_payments: string | null;
  description: string | null;
  processing_notes: string | null;
  property_address: string | null;
  account_status: AccountStatus | null;
  website_name: string | null;
  // All three null while the bill is unmatched.
  vendor_account_id: string | null;
  vendor_id: string | null;
  property_id: string | null;
  // true: the analyst picked the vendor account. false: the account number
  // found it, or nothing did.
  vendor_account_picked: boolean;
  submitted_by: { id: string; full_name: string };
  status: BillStatus;
  exception_reason: string | null;
  document_path: string | null;
  created_at: string;
};

export type DocumentUploadResponse = {
  bill_id: string;
  document_path: string;
  status: string;
};

// `null` means "clear this field" on update;
// an omitted key leaves it unchanged.
export type BillDraftPayload = {
  account_number_raw?: string | null;
  invoice_number?: string | null;
  vendor_name_raw?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  amount?: string | null;
  prev_payments?: string | null;
  description?: string | null;
  processing_notes?: string | null;
  property_address?: string | null;
  account_status?: AccountStatus | null;
  website_name?: string | null;
  // null: the server matches the account number, as on Create.
  vendor_account_id?: string | null;
};

export type BillDraftResponse = {
  bill_id: string;
  status: "draft";
  document_path: string | null;
};

export type BillDraftDetail = {
  bill_id: string;
  status: "draft";
  document_path: string | null;
  account_number_raw: string | null;
  invoice_number: string | null;
  vendor_name_raw: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: string | number | null;
  prev_payments: string | number | null;
  description: string | null;
  processing_notes: string | null;
  property_address: string | null;
  account_status: AccountStatus | null;
  website_name: string | null;
  vendor_account_id: string | null;
  // As on Bill. Only a picked account is sent back on save: the server
  // matches the account number again otherwise.
  vendor_account_picked: boolean;
};

export type DashboardBill = {
  bill_id: string;
  invoice_number: string | null;
  property_address: string | null;
  vendor_name_raw: string | null;
  // The matched vendor's and property's names; null while unmatched.
  vendor_name: string | null;
  property_name: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  status: BillStatus;
  document_path: string | null;
  created_at: string;
};

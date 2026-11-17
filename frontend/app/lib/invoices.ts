import type { DashboardBill } from "@/types/bill";
import type { Invoice } from "@/types/invoice";

export const PROPERTY_MISMATCH_WARNING = "Address doesn't match the vendor account's property";

export function toInvoice(bill: DashboardBill): Invoice {
  return {
    id: bill.bill_id,
    invoiceNumber: bill.invoice_number,
    property: bill.property_name || bill.property_address || "Not assigned",
    company: bill.vendor_name_raw || "Not specified",
    dueDate: bill.due_date,
    vendor: bill.vendor_name || bill.vendor_name_raw || "Not specified",
    amount: bill.amount,
    status: bill.status,
    ...(bill.property_address_mismatch && { propertyWarning: PROPERTY_MISMATCH_WARNING }),
  };
}

import type { DashboardBill } from "@/types/bill";
import { PROPERTY_MISMATCH_WARNING, toInvoice } from "./invoices";

function bill(overrides: Partial<DashboardBill> = {}): DashboardBill {
  return {
    bill_id: "bill-1",
    invoice_number: "INV-1",
    property_address: "125 Industrial Way, Springfield, IL 62701",
    vendor_name_raw: "ALDER CREEK LNDSCP",
    vendor_name: "Alder Creek Landscaping",
    property_name: "Oak Row",
    property_address_mismatch: false,
    invoice_date: "2026-11-01",
    due_date: "2026-11-20",
    amount: 100,
    status: "pending_approval",
    document_path: null,
    created_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

describe("toInvoice", () => {
  it("warns when the address names another property than the vendor account's", () => {
    expect(toInvoice(bill({ property_address_mismatch: true }))).toMatchObject({
      property: "Oak Row",
      propertyWarning: PROPERTY_MISMATCH_WARNING,
    });
  });

  it("gives no warning otherwise", () => {
    expect(toInvoice(bill())).not.toHaveProperty("propertyWarning");
  });
});

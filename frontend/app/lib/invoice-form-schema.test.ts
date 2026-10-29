import { emptyInvoiceForm, invoiceFormSchema } from "./invoice-form-schema";

const validData = {
  accountNumber: "12345",
  statementId: "INV-001",
  companyName: "Acme Utilities",
  propertyAddress: "123 Main St",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  description: "Electric bill",
  previousPayments: "0.00",
  currentDue: "120.50",
  accountStatus: "paid",
  notes: "",
  websiteName: "",
};

describe("invoiceFormSchema", () => {
  it("accepts a fully valid form", () => {
    expect(invoiceFormSchema.safeParse(validData).success).toBe(true);
  });
  it("rejects the empty default form", () => {
    expect(invoiceFormSchema.safeParse(emptyInvoiceForm).success).toBe(false);
  });
});

describe("dates", () => {
  it("allows a due date on the same day as the issue date", () => {
    const result = invoiceFormSchema.safeParse({
      ...validData,
      issueDate: "2026-10-15",
      dueDate: "2026-10-15",
    });
    expect(result.success).toBe(true);
  });
});

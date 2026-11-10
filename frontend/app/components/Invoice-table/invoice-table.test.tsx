import { render, screen } from "@testing-library/react";
import type { Invoice } from "@/types/invoice";
import { InvoiceTable } from "./invoice-table";

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "INV-1001",
  property: "Oak Terrace",
  company: "Northgate LLC",
  dueDate: "2026-10-01",
  vendor: "LADWP",
  amount: 1180.5,
  status: "paid",
  ...overrides,
});

describe("Invoice table", () => {
  it("shows the empty state when there are no invoices", () => {
    render(<InvoiceTable invoices={[]} />);
    expect(screen.getByText(/No invoices yet/)).toBeInTheDocument();
  });

  it("renders an invoice with formatted amount and date", () => {
    render(<InvoiceTable invoices={[makeInvoice()]} />);

    expect(screen.getByText("INV-1001")).toBeInTheDocument();
    expect(screen.getByText("Oak Terrace")).toBeInTheDocument();
    expect(screen.getByText("Northgate LLC")).toBeInTheDocument();
    expect(screen.getByText("LADWP")).toBeInTheDocument();
    expect(screen.getByText("$1,180.50")).toBeInTheDocument();
    expect(screen.getByText("Oct 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("renders drafts that share an invoice number without duplicate React keys", () => {
    // Drafts can share an invoice number until a vendor account is set.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    render(
      <InvoiceTable
        invoices={[
          makeInvoice({ id: "bill-a", invoiceNumber: "INV-7" }),
          makeInvoice({ id: "bill-b", invoiceNumber: "INV-7" }),
        ]}
      />,
    );

    expect(screen.getAllByText("INV-7")).toHaveLength(2);
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes("same key"),
    );
    expect(keyWarnings).toHaveLength(0);
    consoleError.mockRestore();
  });
});

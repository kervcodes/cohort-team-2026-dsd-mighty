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

const draftInvoice = makeInvoice({
  id: "draft-1001",
  invoiceNumber: "INV-DRAFT-1",
  status: "draft",
});

const approvedInvoice = makeInvoice({
  id: "approved-1001",
  invoiceNumber: "INV-APPROVED-1",
  status: "approved",
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

    try {
      render(
        <InvoiceTable
          invoices={[
            makeInvoice({
              id: "bill-a",
              invoiceNumber: "INV-7",
              status: "draft",
            }),
            makeInvoice({
              id: "bill-b",
              invoiceNumber: "INV-7",
              status: "draft",
            }),
          ]}
        />,
      );

      expect(screen.getAllByText("INV-7")).toHaveLength(2);

      const keyWarnings = consoleError.mock.calls.filter((args) =>
        String(args[0]).includes("same key"),
      );

      expect(keyWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("links draft invoices to the edit page", () => {
    render(<InvoiceTable invoices={[draftInvoice]} />);

    expect(screen.getByRole("link", { name: "INV-DRAFT-1" })).toHaveAttribute(
      "href",
      `/invoices/${draftInvoice.id}/edit`,
    );
  });

  it("links approved invoices to the detail page, not the edit page", () => {
    render(<InvoiceTable invoices={[approvedInvoice]} />);

    const link = screen.getByRole("link", { name: "INV-APPROVED-1" });

    expect(link).toHaveAttribute("href", "/invoices/approved-1001");
  });

  it("links paid invoices to the detail page, not the edit page", () => {
    const paidInvoice: Invoice = {
      id: "paid-1001",
      invoiceNumber: "INV-PAID-1",
      property: "123 Main Street",
      company: "Electric Company",
      dueDate: "2026-11-01",
      vendor: "Electric Company",
      amount: 250,
      status: "paid",
    };
    render(<InvoiceTable invoices={[paidInvoice]} />);

    const link = screen.getByRole("link", { name: "INV-PAID-1" });

    expect(link).toHaveAttribute("href", "/invoices/paid-1001");
  });
});

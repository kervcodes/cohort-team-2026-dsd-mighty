import { render, screen, waitFor } from "@testing-library/react";

import { useAuth } from "@/auth/AuthProvider";
import { getDashboardBills } from "@/lib/api/bills";
import type { DashboardBill } from "@/types/bill";
import type { Invoice } from "@/types/invoice";

import DraftsPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/bills", () => ({
  getDashboardBills: jest.fn(),
}));

jest.mock("@/components/Invoice-table/invoice-table", () => ({
  InvoiceTable: ({
    invoices,
    title,
    emptyMessage,
  }: {
    invoices: Invoice[];
    title: string;
    emptyMessage: string;
  }) => (
    <div data-testid="invoice-table" data-invoices={JSON.stringify(invoices)}>
      <h2>{title}</h2>
      {invoices.length === 0 && <p>{emptyMessage}</p>}
    </div>
  ),
}));

function bill(overrides: Partial<DashboardBill> = {}): DashboardBill {
  return {
    bill_id: "bill-1",
    invoice_number: "INV-001",
    property_address: "123 Main St",
    vendor_name_raw: "Acme Supplies",
    due_date: "2026-12-01",
    amount: 100,
    status: "draft",
    ...overrides,
  } as DashboardBill;
}

function tableInvoices(): Invoice[] {
  const table = screen.getByTestId("invoice-table");
  return JSON.parse(table.getAttribute("data-invoices") ?? "[]");
}

describe("DraftsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useAuth).mockReturnValue({
      profile: { status: "active" },
      loading: false,
    } as ReturnType<typeof useAuth>);
  });

  it("shows a loading state while drafts are being fetched", async () => {
    let resolveBills!: (bills: DashboardBill[]) => void;

    jest.mocked(getDashboardBills).mockReturnValue(
      new Promise((resolve) => {
        resolveBills = resolve;
      }),
    );

    render(<DraftsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading drafts...");

    resolveBills([]);

    await waitFor(() => {
      expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
    });
  });

  it("displays an error when drafts fail to load", async () => {
    jest.mocked(getDashboardBills).mockRejectedValue(new Error("Unable to fetch bills."));

    render(<DraftsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to fetch bills.");

    expect(screen.queryByTestId("invoice-table")).not.toBeInTheDocument();
  });

  it("displays only draft bills in the Saved Drafts table", async () => {
    jest
      .mocked(getDashboardBills)
      .mockResolvedValue([
        bill({ bill_id: "draft-1", status: "draft" }),
        bill({ bill_id: "pending-1", status: "pending_approval" }),
        bill({ bill_id: "draft-2", status: "draft" }),
        bill({ bill_id: "approved-1", status: "approved" }),
      ]);

    render(<DraftsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { level: 1, name: "Saved Drafts" })).toBeInTheDocument();

    expect(tableInvoices().map((invoice) => invoice.id)).toEqual(["draft-1", "draft-2"]);

    expect(tableInvoices()).toHaveLength(2);
  });

  it("maps draft bill details into invoice table data", async () => {
    jest.mocked(getDashboardBills).mockResolvedValue([
      bill({
        bill_id: "draft-1",
        invoice_number: "INV-100",
        property_address: "456 Oak Street",
        vendor_name_raw: "Office Supplies Co.",
        due_date: "2026-12-15",
        amount: 250,
      }),
    ]);

    render(<DraftsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
    });

    expect(tableInvoices()[0]).toMatchObject({
      id: "draft-1",
      invoiceNumber: "INV-100",
      property: "456 Oak Street",
      company: "Office Supplies Co.",
      vendor: "Office Supplies Co.",
      dueDate: "2026-12-15",
      amount: 250,
      status: "draft",
    });
  });

  it("displays an empty state when there are no saved drafts", async () => {
    jest
      .mocked(getDashboardBills)
      .mockResolvedValue([
        bill({ bill_id: "pending-1", status: "pending_approval" }),
        bill({ bill_id: "approved-1", status: "approved" }),
      ]);

    render(<DraftsPage />);

    expect(
      await screen.findByText("No saved drafts yet. Create an invoice and save it as a draft."),
    ).toBeInTheDocument();

    expect(tableInvoices()).toHaveLength(0);
  });

  it("links to the new invoice form", () => {
    jest.mocked(getDashboardBills).mockResolvedValue([]);

    render(<DraftsPage />);

    expect(screen.getByRole("link", { name: /new invoice/i })).toHaveAttribute(
      "href",
      "/invoices/new",
    );
  });
});

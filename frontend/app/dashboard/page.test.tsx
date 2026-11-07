import { render, screen } from "@testing-library/react";
import { getDashboardBills } from "@/lib/api/bills";
import type { DashboardBill } from "@/types/bill";
import DashboardPage from "./page";

// One test id per table so the drafts table and the history table can be told
// apart. The invoices are serialized so tests can check what each table got.

jest.mock("@/components/Invoice-table/invoice-table", () => ({
  InvoiceTable: ({ invoices, title }: { invoices: unknown[]; title: string }) => (
    <div
      data-testid={`invoice-table-${title}`}
      data-count={invoices.length}
      data-invoices={JSON.stringify(invoices)}
    />
  ),
}));

// The real module reads the Supabase session and calls the backend.
jest.mock("@/lib/api/bills", () => ({
  getDashboardBills: jest.fn(),
}));

const mockGetDashboardBills = getDashboardBills as jest.MockedFunction<typeof getDashboardBills>;

function bill(overrides: Partial<DashboardBill> = {}): DashboardBill {
  return {
    bill_id: "bill-1",
    invoice_number: "INV-1",
    property_address: "1 Main St",
    vendor_name_raw: "Acme Power",
    invoice_date: "2026-11-01",
    due_date: "2026-11-20",
    amount: 100,
    status: "draft",
    document_path: null,
    created_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const DRAFTS_TABLE = "invoice-table-Saved Drafts";
const HISTORY_TABLE = "invoice-table-Invoice History";

async function renderLoaded(bills: DashboardBill[]) {
  mockGetDashboardBills.mockResolvedValue(bills);
  render(<DashboardPage />);
  await screen.findByTestId(HISTORY_TABLE);
}

function tableInvoices(testId: string) {
  return JSON.parse(screen.getByTestId(testId).getAttribute("data-invoices") ?? "[]");
}

describe("Dashboard", () => {
  beforeEach(() => {
    mockGetDashboardBills.mockReset();
  });
  describe("loading and errors", () => {
    it("shows a loading state, then both invoice tables", async () => {
      mockGetDashboardBills.mockResolvedValue([bill(), bill({ bill_id: "bill-2" })]);
      render(<DashboardPage />);

      expect(screen.getByRole("status")).toHaveTextContent("Loading invoices...");
      expect(screen.queryByTestId(HISTORY_TABLE)).not.toBeInTheDocument();

      expect(await screen.findByTestId(DRAFTS_TABLE)).toHaveAttribute("data-count", "2");
      expect(screen.getByTestId(HISTORY_TABLE)).toHaveAttribute("data-count", "2");
      expect(screen.queryByText("Loading invoices...")).not.toBeInTheDocument();
    });

    it("shows the error and no tables or stats when loading fails", async () => {
      mockGetDashboardBills.mockRejectedValue(new Error("You must be signed in to view invoices."));
      render(<DashboardPage />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You must be signed in to view invoices.",
      );
      expect(screen.queryByTestId(DRAFTS_TABLE)).not.toBeInTheDocument();
      expect(screen.queryByTestId(HISTORY_TABLE)).not.toBeInTheDocument();
      expect(screen.queryByText("Outstanding")).not.toBeInTheDocument();
      expect(screen.queryByText("Loading invoices...")).not.toBeInTheDocument();
    });

    it("totals outstanding bills and bills due today", async () => {
      mockGetDashboardBills.mockResolvedValue([
        bill({
          bill_id: "a",
          status: "pending_approval",
          amount: 100,
          due_date: isoDaysFromNow(0),
        }),
        bill({
          bill_id: "b",
          status: "approved",
          amount: 50.5,
          due_date: "2099-01-01",
        }),
        bill({
          bill_id: "c",
          status: "paid",
          amount: 999,
          due_date: isoDaysFromNow(0),
        }),
        bill({ bill_id: "d", status: "draft", amount: null, due_date: null }),
      ]);
      render(<DashboardPage />);

      await screen.findByTestId("invoice-table-Invoice History");
      // Outstanding = pending_approval + approved; due this week includes
      // today and excludes paid bills.
      expect(screen.getByText("$150.50")).toBeInTheDocument();
      expect(screen.getByText("$100.00")).toBeInTheDocument();
    });
  });

  describe("drafts and history", () => {
    it("shows only drafts in Saved Drafts and every bill in Invoice History", async () => {
      await renderLoaded([
        bill({ bill_id: "d1", status: "draft" }),
        bill({ bill_id: "d2", status: "draft" }),
        bill({ bill_id: "p1", status: "pending_approval" }),
      ]);

      expect(screen.getByTestId(DRAFTS_TABLE)).toHaveAttribute("data-count", "2");
      expect(screen.getByTestId(HISTORY_TABLE)).toHaveAttribute("data-count", "3");
      expect(tableInvoices(DRAFTS_TABLE).map((i: { id: string }) => i.id)).toEqual(["d1", "d2"]);

      // "Saved drafts" stat card
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("Not yet submitted")).toBeInTheDocument();
    });

    it("maps a bill to an invoice and fills in missing fields", async () => {
      await renderLoaded([
        bill({
          bill_id: "x",
          invoice_number: "INV-9",
          property_address: null,
          vendor_name_raw: null,
          due_date: null,
          amount: 12,
          status: "approved",
        }),
      ]);

      expect(tableInvoices(HISTORY_TABLE)[0]).toMatchObject({
        id: "x",
        invoiceNumber: "INV-9",
        property: "Not assigned",
        company: "Not specified",
        vendor: "Not specified",
        dueDate: null,
        amount: 12,
        status: "approved",
      });
    });
  });

  it("links to the new invoice form", async () => {
    await renderLoaded([]);

    expect(screen.getByRole("link", { name: /new invoice/i })).toHaveAttribute(
      "href",
      "/invoices/new",
    );
  });
});

import { render, screen } from "@testing-library/react";
import { type DashboardBill, getDashboardBills } from "@/lib/api/bills";
import DashboardPage from "./page";

jest.mock("@/components/Invoice-table/invoice-table", () => ({
  InvoiceTable: ({ invoices }: { invoices: unknown[] }) => (
    <div data-testid="invoice-table" data-count={invoices.length} />
  ),
}));

// The real module reads the Supabase session and calls the backend.
jest.mock("@/lib/api/bills", () => ({
  getDashboardBills: jest.fn(),
}));

const mockGetDashboardBills = getDashboardBills as jest.MockedFunction<typeof getDashboardBills>;

const mockUseAuth = jest.fn();

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

function account(loading: boolean, status: "active" | "inactive" = "active") {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1" },
    profile: loading ? null : { id: "user-1", status },
    profileError: null,
    loading,
  });
}

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

describe("Dashboard", () => {
  beforeEach(() => {
    mockGetDashboardBills.mockReset();
    account(false);
  });

  it("waits for the account to load before asking for invoices", async () => {
    mockGetDashboardBills.mockResolvedValue([bill()]);
    account(true);
    const { rerender } = render(<DashboardPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading invoices...");
    expect(mockGetDashboardBills).not.toHaveBeenCalled();

    account(false);
    rerender(<DashboardPage />);

    expect(await screen.findByTestId("invoice-table")).toHaveAttribute("data-count", "1");
    expect(mockGetDashboardBills).toHaveBeenCalledTimes(1);
  });

  it("never asks for an inactive user's invoices", () => {
    account(false, "inactive");
    render(<DashboardPage />);

    expect(mockGetDashboardBills).not.toHaveBeenCalled();
  });

  it("shows a loading state, then the invoice table", async () => {
    mockGetDashboardBills.mockResolvedValue([bill(), bill({ bill_id: "bill-2" })]);
    render(<DashboardPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading invoices...");

    const table = await screen.findByTestId("invoice-table");
    expect(table).toHaveAttribute("data-count", "2");
    expect(screen.queryByText("Loading invoices...")).not.toBeInTheDocument();
  });

  it("shows the error and no table when loading fails", async () => {
    mockGetDashboardBills.mockRejectedValue(new Error("You must be signed in to view invoices."));
    render(<DashboardPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You must be signed in to view invoices.",
    );
    expect(screen.queryByTestId("invoice-table")).not.toBeInTheDocument();
  });

  it("totals outstanding bills and bills due today", async () => {
    mockGetDashboardBills.mockResolvedValue([
      bill({ bill_id: "a", status: "pending_approval", amount: 100, due_date: isoDaysFromNow(0) }),
      bill({ bill_id: "b", status: "approved", amount: 50.5, due_date: "2099-01-01" }),
      bill({ bill_id: "c", status: "paid", amount: 999, due_date: isoDaysFromNow(0) }),
      bill({ bill_id: "d", status: "draft", amount: null, due_date: null }),
    ]);
    render(<DashboardPage />);

    await screen.findByTestId("invoice-table");
    // Outstanding = pending_approval + approved; due this week includes
    // today and excludes paid bills.
    expect(screen.getByText("$150.50")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
  });
});

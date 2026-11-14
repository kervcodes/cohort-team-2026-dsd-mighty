import { render, screen, waitFor } from "@testing-library/react";
import { useAuth } from "@/auth/AuthProvider";
import { getApprovals } from "@/lib/api/approvals";
import { getBill } from "@/lib/api/bills";
import type { Approval } from "@/types/approval";
import type { Bill } from "@/types/bill";
import ApprovalsPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/approvals", () => ({
  getApprovals: jest.fn(),
}));

jest.mock("@/lib/api/bills", () => ({
  getBill: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockGetApprovals = getApprovals as jest.Mock;
const mockGetBill = getBill as jest.Mock;

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "approval-123",
    bill_id: "bill-123",
    status: "pending",
    reviewer: null,
    comments: null,
    requested_at: "2026-11-01T10:00:00Z",
    decided_at: null,
    ...overrides,
  };
}

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-123",
    account_number_raw: "ACC-1001",
    vendor_name_raw: "Acme Utilities",
    invoice_number: "INV-1001",
    invoice_date: "2026-11-01",
    due_date: "2026-11-30",
    amount: "2500.00",
    prev_payments: null,
    description: "Monthly utility bill",
    processing_notes: null,
    property_address: "123 Main Street",
    account_status: "unpaid",
    website_name: null,
    vendor_account_id: null,
    submitted_by: {
      id: "user-123",
      full_name: "John Smith",
    },
    status: "pending_approval",
    exception_reason: null,
    document_path: null,
    created_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function signInAs(
  role: "admin" | "analyst" | "approver" | null,
  status: "active" | "inactive" = "active",
  loading = false,
) {
  mockUseAuth.mockReturnValue({
    profile: role ? { role, status } : null,
    loading,
  });
}

function setupPage(options?: {
  role?: "admin" | "analyst" | "approver" | null;
  status?: "active" | "inactive";
  accountLoading?: boolean;
  approvals?: Approval[];
  bills?: Bill[];
}) {
  signInAs(
    options?.role === undefined ? "approver" : options.role,
    options?.status ?? "active",
    options?.accountLoading ?? false,
  );

  const approvals = options?.approvals ?? [approval()];
  const bills = options?.bills ?? [bill()];

  mockGetApprovals.mockResolvedValue(approvals);

  mockGetBill.mockImplementation(async (billId: string) => {
    const matchingBill = bills.find((item) => item.id === billId);

    if (!matchingBill) {
      throw new Error("Invoice not found.");
    }

    return matchingBill;
  });

  render(<ApprovalsPage />);
}

describe("ApprovalsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    signInAs("approver");

    mockGetApprovals.mockResolvedValue([approval()]);
    mockGetBill.mockResolvedValue(bill());
  });

  describe("Access control", () => {
    it.each(["approver", "admin"] as const)(
      "allows an active %s to view the approval queue",
      async (role) => {
        setupPage({ role });

        expect(
          await screen.findByRole("heading", {
            name: "Approval Queue",
          }),
        ).toBeInTheDocument();

        expect(screen.getByText("Review invoices awaiting approval.")).toBeInTheDocument();

        expect(mockGetApprovals).toHaveBeenCalledWith({
          status: "pending",
          limit: 100,
        });
      },
    );

    it.each(["analyst", null] as const)("denies access to role %s", async (role) => {
      setupPage({ role });

      expect(screen.getByRole("heading", { name: "Approvals" })).toBeInTheDocument();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "You do not have permission to view approvals.",
      );

      expect(mockGetApprovals).not.toHaveBeenCalled();
    });

    it("denies access to an inactive approver", () => {
      setupPage({
        role: "approver",
        status: "inactive",
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "You do not have permission to view approvals.",
      );

      expect(mockGetApprovals).not.toHaveBeenCalled();
    });

    it("shows a loading message while account permissions load", () => {
      setupPage({
        role: "approver",
        accountLoading: true,
      });

      expect(screen.getByRole("status")).toHaveTextContent("Loading account...");

      expect(mockGetApprovals).not.toHaveBeenCalled();
    });
  });

  describe("Approval queue", () => {
    it("loads and displays pending approvals", async () => {
      setupPage();

      expect(await screen.findByRole("link", { name: "INV-1001" })).toBeInTheDocument();

      expect(screen.getByText("Acme Utilities")).toBeInTheDocument();
      expect(screen.getByText("123 Main Street")).toBeInTheDocument();
      expect(screen.getByText("$2,500.00")).toBeInTheDocument();
      expect(screen.getByText("Nov 1, 2026")).toBeInTheDocument();

      expect(screen.getByRole("link", { name: "INV-1001" })).toHaveAttribute(
        "href",
        "/invoices/bill-123",
      );

      expect(mockGetBill).toHaveBeenCalledWith("bill-123");
    });

    it("shows multiple pending approvals", async () => {
      const approvals = [
        approval(),
        approval({
          id: "approval-456",
          bill_id: "bill-456",
          requested_at: "2026-11-02T10:00:00Z",
        }),
      ];

      const bills = [
        bill(),
        bill({
          id: "bill-456",
          invoice_number: "INV-1002",
          vendor_name_raw: "ABC Plumbing",
          property_address: "456 Oak Street",
          amount: "1800.00",
        }),
      ];

      setupPage({ approvals, bills });

      expect(await screen.findByRole("link", { name: "INV-1001" })).toBeInTheDocument();

      expect(screen.getByRole("link", { name: "INV-1002" })).toBeInTheDocument();

      expect(screen.getByText("ABC Plumbing")).toBeInTheDocument();
      expect(screen.getByText("456 Oak Street")).toBeInTheDocument();

      expect(mockGetBill).toHaveBeenCalledTimes(2);
    });

    it("shows an empty state when no pending approvals exist", async () => {
      setupPage({ approvals: [] });

      expect(
        await screen.findByRole("heading", {
          name: "No pending approvals",
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText("You're all caught up. New invoices awaiting review will appear here."),
      ).toBeInTheDocument();

      expect(mockGetBill).not.toHaveBeenCalled();
    });

    it("shows a loading state while approvals load", () => {
      mockGetApprovals.mockReturnValue(new Promise<Approval[]>(() => {}));

      signInAs("approver");

      render(<ApprovalsPage />);

      expect(screen.getByRole("status")).toHaveTextContent("Loading pending approvals...");
    });
  });

  describe("Admin review requirements", () => {
    it("shows an admin review warning for an approver reviewing an invoice over $5,000", async () => {
      setupPage({
        role: "approver",
        bills: [bill({ amount: "6000.00" })],
      });

      expect(await screen.findByText("Admin review required")).toBeInTheDocument();

      expect(screen.getByText("$6,000.00")).toBeInTheDocument();
    });

    it("does not show an admin review warning to an admin", async () => {
      setupPage({
        role: "admin",
        bills: [bill({ amount: "6000.00" })],
      });

      await screen.findByRole("link", { name: "INV-1001" });

      expect(screen.queryByText("Admin review required")).not.toBeInTheDocument();

      expect(screen.getByText("pending approval")).toBeInTheDocument();
    });

    it("does not require admin review for an invoice of exactly $5,000", async () => {
      setupPage({
        role: "approver",
        bills: [bill({ amount: "5000.00" })],
      });

      await screen.findByRole("link", { name: "INV-1001" });

      expect(screen.queryByText("Admin review required")).not.toBeInTheDocument();
    });
  });

  describe("Error handling", () => {
    it("shows an error when pending approvals fail to load", async () => {
      mockGetApprovals.mockRejectedValueOnce(new Error("Unable to load pending approvals."));

      setupPage();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to load pending approvals.",
      );
    });

    it("shows an error when an associated invoice fails to load", async () => {
      mockGetBill.mockRejectedValueOnce(new Error("Unable to load invoice."));

      setupPage();

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load invoice.");
    });
  });
});

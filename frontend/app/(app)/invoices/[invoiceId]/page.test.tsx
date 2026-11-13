import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useParams } from "next/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { decideApproval, getApprovals } from "@/lib/api/approvals";
import { getBill, getBillDocument } from "@/lib/api/bills";
import type { Approval } from "@/types/approval";
import type { Bill } from "@/types/bill";
import InvoiceDetailPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(),
}));

jest.mock("@/lib/api/bills", () => ({
  getBill: jest.fn(),
  getBillDocument: jest.fn(),
}));

jest.mock("@/lib/api/approvals", () => ({
  getApprovals: jest.fn(),
  decideApproval: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockUseParams = useParams as jest.Mock;
const mockGetBill = getBill as jest.Mock;
const mockGetBillDocument = getBillDocument as jest.Mock;
const mockGetApprovals = getApprovals as jest.Mock;
const mockDecideApproval = decideApproval as jest.Mock;

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
  billOverrides?: Partial<Bill>;
  approvals?: Approval[];
}) {
  signInAs(
    options?.role === undefined ? "approver" : options.role,
    options?.status ?? "active",
    options?.accountLoading ?? false,
  );

  mockGetBill.mockResolvedValue(bill(options?.billOverrides));
  mockGetApprovals.mockResolvedValue(options?.approvals ?? [approval()]);

  render(<InvoiceDetailPage />);
}

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseParams.mockReturnValue({ id: "bill-123" });

    mockGetBill.mockResolvedValue(bill());
    mockGetBillDocument.mockResolvedValue({
      document_url: "https://example.com/invoice.pdf",
    });
    mockGetApprovals.mockResolvedValue([approval()]);
    mockDecideApproval.mockImplementation(
      async (approvalId: string, payload: { decision: string; comments: string | null }) =>
        approval({
          id: approvalId,
          status: payload.decision === "approve" ? "approved" : "rejected",
          comments: payload.comments,
        }),
    );
  });

  describe("Invoice details", () => {
    it("loads and displays the invoice", async () => {
      setupPage();

      expect(await screen.findByRole("heading", { name: "INV-1001" })).toBeInTheDocument();

      expect(screen.getByText("Acme Utilities")).toBeInTheDocument();
      expect(screen.getByText("123 Main Street")).toBeInTheDocument();
      expect(screen.getByText("ACC-1001")).toBeInTheDocument();
      expect(screen.getByText("John Smith")).toBeInTheDocument();

      expect(mockGetBill).toHaveBeenCalledWith("bill-123");
    });

    it("shows an error when the invoice fails to load", async () => {
      mockGetBill.mockRejectedValueOnce(new Error("Unable to load invoice."));

      setupPage();

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load invoice.");
    });
  });
  describe("Approval access", () => {
    it.each(["approver", "admin"] as const)(
      "shows the approval panel for an active %s",
      async (role) => {
        setupPage({ role });

        expect(
          await screen.findByRole("heading", {
            name: "Approval Decision",
          }),
        ).toBeInTheDocument();

        expect(
          await screen.findByRole("button", {
            name: "Approve invoice",
          }),
        ).toBeInTheDocument();
      },
    );

    it.each(["analyst", null] as const)(
      "does not show the approval panel for role %s",
      async (role) => {
        setupPage({ role });

        await screen.findByRole("heading", { name: "INV-1001" });

        expect(
          screen.queryByRole("heading", {
            name: "Approval Decision",
          }),
        ).not.toBeInTheDocument();

        expect(mockGetApprovals).not.toHaveBeenCalled();
      },
    );

    it("does not show the approval panel for an inactive approver", async () => {
      setupPage({ role: "approver", status: "inactive" });

      await screen.findByRole("heading", { name: "INV-1001" });

      expect(
        screen.queryByRole("heading", {
          name: "Approval Decision",
        }),
      ).not.toBeInTheDocument();

      expect(mockGetApprovals).not.toHaveBeenCalled();
    });

    it("does not show the approval panel while account permissions load", async () => {
      setupPage({ role: "approver", accountLoading: true });

      await screen.findByRole("heading", { name: "INV-1001" });

      expect(
        screen.queryByRole("heading", {
          name: "Approval Decision",
        }),
      ).not.toBeInTheDocument();

      expect(mockGetApprovals).not.toHaveBeenCalled();
    });

    it.each(["approved", "rejected", "paid"] as const)(
      "does not show the approval panel for a %s invoice",
      async (status) => {
        setupPage({
          role: "approver",
          billOverrides: { status },
        });

        await screen.findByRole("heading", { name: "INV-1001" });

        expect(
          screen.queryByRole("heading", {
            name: "Approval Decision",
          }),
        ).not.toBeInTheDocument();

        expect(mockGetApprovals).not.toHaveBeenCalled();
      },
    );

    it("shows an admin-only message for invoices over $5,000", async () => {
      setupPage({
        role: "approver",
        billOverrides: { amount: "6000.00" },
      });

      expect(await screen.findByText("Admin review required")).toBeInTheDocument();

      expect(screen.queryByRole("button", { name: "Approve invoice" })).not.toBeInTheDocument();
    });
  });

  describe("Approval loading", () => {
    it("shows a loading state while approval details load", async () => {
      mockUseAuth.mockReturnValue({
        profile: {
          role: "approver",
          status: "active",
        },
        loading: false,
      });

      mockUseParams.mockReturnValue({ id: "bill-123" });

      mockGetBill.mockResolvedValue(bill());

      mockGetApprovals.mockImplementation(() => new Promise<Approval[]>(() => {}));

      render(<InvoiceDetailPage />);

      // Wait until the invoice has loaded.
      await screen.findByRole("heading", { name: "INV-1001" });

      // Verify the approval API was called.
      await waitFor(() => {
        expect(mockGetApprovals).toHaveBeenCalledWith({
          status: "pending",
          bill_id: "bill-123",
          limit: 1,
        });
      });

      // The unresolved Promise should keep the loading state visible.
      expect(await screen.findByText("Loading approval details...")).toBeInTheDocument();
    });

    it("shows a message when no pending approval exists", async () => {
      setupPage({ approvals: [] });

      expect(
        await screen.findByText("No pending approval record was found for this invoice."),
      ).toBeInTheDocument();
    });

    it("shows an error when approval details fail to load", async () => {
      mockGetApprovals.mockRejectedValueOnce(new Error("Unable to load approval."));

      setupPage();

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load approval.");
    });
  });

  describe("Approve invoice", () => {
    it("requires confirmation before submitting an approval", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve invoice",
        }),
      );

      expect(
        screen.getByRole("heading", {
          name: "Approve this invoice?",
        }),
      ).toBeInTheDocument();

      expect(mockDecideApproval).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(screen.getByRole("button", { name: "Confirm approval" })).toBeInTheDocument();

      expect(mockDecideApproval).not.toHaveBeenCalled();
    });

    it("submits an approval with optional comments", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve invoice",
        }),
      );

      await user.type(
        screen.getByRole("textbox", { name: /comments/i }),
        "Verified against the invoice.",
      );

      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Confirm approval" }));

      await waitFor(() => {
        expect(mockDecideApproval).toHaveBeenCalledWith("approval-123", {
          decision: "approve",
          comments: "Verified against the invoice.",
        });
      });

      expect(
        screen.queryByRole("heading", {
          name: "Approval Decision",
        }),
      ).not.toBeInTheDocument();
    });

    it("allows approval without comments", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve invoice",
        }),
      );

      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Confirm approval" }));

      await waitFor(() => {
        expect(mockDecideApproval).toHaveBeenCalledWith("approval-123", {
          decision: "approve",
          comments: null,
        });
      });
    });
  });

  describe("Reject invoice", () => {
    it("does not allow continuing with an empty rejection comment", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Reject invoice",
        }),
      );

      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

      expect(mockDecideApproval).not.toHaveBeenCalled();
    });

    it("does not allow continuing with whitespace-only comments", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Reject invoice",
        }),
      );

      await user.type(screen.getByRole("textbox", { name: /comments/i }), "   ");

      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

      expect(mockDecideApproval).not.toHaveBeenCalled();
    });

    it("requires confirmation before submitting a rejection", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Reject invoice",
        }),
      );

      await user.type(
        screen.getByRole("textbox", { name: /comments/i }),
        "Incorrect account number.",
      );

      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(screen.getByText("Confirm that you want to reject this invoice.")).toBeInTheDocument();

      expect(mockDecideApproval).not.toHaveBeenCalled();
    });

    it("submits a rejection with trimmed comments", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Reject invoice",
        }),
      );

      await user.type(
        screen.getByRole("textbox", { name: /comments/i }),
        "  Incorrect account number.  ",
      );

      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

      await waitFor(() => {
        expect(mockDecideApproval).toHaveBeenCalledWith("approval-123", {
          decision: "reject",
          comments: "Incorrect account number.",
        });
      });

      expect(
        screen.queryByRole("heading", {
          name: "Approval Decision",
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Decision controls and errors", () => {
    it("cancels a decision without submitting it", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve invoice",
        }),
      );

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.getByRole("button", { name: "Approve invoice" })).toBeInTheDocument();

      expect(mockDecideApproval).not.toHaveBeenCalled();
    });

    it("allows the reviewer to go back from confirmation", async () => {
      const user = userEvent.setup();

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve invoice",
        }),
      );

      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Go back" }));

      expect(
        screen.getByRole("heading", {
          name: "Approve this invoice?",
        }),
      ).toBeInTheDocument();

      expect(mockDecideApproval).not.toHaveBeenCalled();
    });

    it("shows an error when the decision API fails", async () => {
      const user = userEvent.setup();

      mockDecideApproval.mockRejectedValueOnce(new Error("Unable to submit your decision."));

      setupPage();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve invoice",
        }),
      );

      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Confirm approval" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to submit your decision.");

      expect(screen.getByRole("button", { name: "Confirm approval" })).toBeInTheDocument();
    });
  });
});

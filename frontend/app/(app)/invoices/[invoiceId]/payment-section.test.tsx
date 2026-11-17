import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useParams } from "next/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { getApprovals } from "@/lib/api/approvals";
import { getBill, getBillDocument } from "@/lib/api/bills";
import { getPaymentRun, listPaymentRuns } from "@/lib/api/payment-runs";
import { listPayments, recordPayment } from "@/lib/api/payments";
import type { Bill, BillStatus } from "@/types/bill";
import type { Payment } from "@/types/payment";
import type { PaymentRun } from "@/types/payment-run";
import InvoiceDetailPage from "./page";

// The Payment section of the bill page: Mark as paid (BillPayments) and Pay
// with AI, for approved and paid bills. Each panel's own rules are tested in
// its folder; this file checks where they appear and that a payment reloads
// the bill.

jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("next/navigation", () => ({ useParams: jest.fn() }));
jest.mock("@/lib/api/bills", () => ({ getBill: jest.fn(), getBillDocument: jest.fn() }));
jest.mock("@/lib/api/approvals", () => ({ getApprovals: jest.fn(), decideApproval: jest.fn() }));
jest.mock("@/lib/api/payments", () => ({ listPayments: jest.fn(), recordPayment: jest.fn() }));
jest.mock("@/lib/api/payment-runs", () => ({
  listPaymentRuns: jest.fn(),
  getPaymentRun: jest.fn(),
  startPaymentRun: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockGetBill = getBill as jest.Mock;
const mockListPayments = listPayments as jest.Mock;
const mockRecordPayment = recordPayment as jest.Mock;
const mockListRuns = listPaymentRuns as jest.Mock;
const mockGetRun = getPaymentRun as jest.Mock;

type Role = "analyst" | "approver" | "admin";

function bill(status: BillStatus): Bill {
  return {
    id: "bill-123",
    account_number_raw: "ACC-1001",
    vendor_name_raw: "Acme Utilities",
    invoice_number: "INV-1001",
    invoice_date: "2026-11-01",
    due_date: "2026-11-30",
    amount: "2500.00",
    prev_payments: null,
    description: null,
    processing_notes: null,
    property_address: "123 Main Street",
    account_status: "unpaid",
    website_name: null,
    vendor_account_id: "account-1",
    vendor_id: "vendor-1",
    property_id: "property-1",
    vendor_account_picked: false,
    submitted_by: { id: "user-analyst", full_name: "John Smith" },
    status,
    exception_reason: null,
    document_path: null,
    created_at: "2026-11-01T10:00:00Z",
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    bill_id: "bill-123",
    amount: "2500.00",
    payment_method: "ach",
    payment_status: "completed",
    paid_on: "2026-11-14",
    reference: "CONF-1",
    failure_reason: null,
    attempt_number: 1,
    recorded_by: "user-me",
    created_at: "2026-11-14T18:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<PaymentRun> = {}): PaymentRun {
  return {
    id: "run-1",
    bill_id: "bill-123",
    started_by: "user-pat",
    started_by_name: "Pat Lee",
    status: "running",
    steps: [{ at: "2026-11-15T15:00:00Z", step: "queued", detail: "Queued by Pat Lee." }],
    flag_reason: null,
    receipt: null,
    payment_id: null,
    created_at: "2026-11-15T15:00:00Z",
    started_at: "2026-11-15T15:00:01Z",
    finished_at: null,
    updated_at: "2026-11-15T15:00:01Z",
    ...overrides,
  };
}

const paidRun = run({
  status: "paid",
  receipt: {
    confirmation_number: "CONF-778",
    bill_number: "INV-1001",
    amount: "2500.00",
    paid_on: "2026-11-15",
    outcome: "successful",
    portal: "https://portal.example.com",
  },
  payment_id: "pay-2",
  finished_at: "2026-11-15T15:01:00Z",
});

function signInAs(role: Role, status: "active" | "inactive" = "active") {
  mockUseAuth.mockReturnValue({
    profile: { id: "user-me", full_name: "Me", email: "me@example.com", role, status },
    loading: false,
  });
}

async function openPage(status: BillStatus, role: Role = "approver") {
  signInAs(role);
  mockGetBill.mockResolvedValue(bill(status));
  render(<InvoiceDetailPage />);
  await screen.findByRole("heading", { name: "INV-1001" });
}

function paymentSection() {
  return screen.getByRole("region", { name: "Payment" });
}

// The status badge next to the invoice number.
function headerStatus() {
  const header = screen.getByRole("heading", { name: "INV-1001" }).closest("section");
  if (!header) throw new Error("no header section");
  return header;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useParams as jest.Mock).mockReturnValue({ invoiceId: "bill-123" });
  (getBillDocument as jest.Mock).mockResolvedValue({ document_url: "https://example.com/a.pdf" });
  (getApprovals as jest.Mock).mockResolvedValue([]);
  mockListPayments.mockResolvedValue([]);
  mockListRuns.mockResolvedValue([]);
});

describe("which bills have a Payment section", () => {
  it.each<BillStatus>(["draft", "pending_approval", "rejected"])(
    "has none on a %s bill, and loads no payments or runs",
    async (status) => {
      await openPage(status, "admin");

      expect(screen.queryByRole("heading", { name: "Payment" })).not.toBeInTheDocument();
      expect(mockListPayments).not.toHaveBeenCalled();
      expect(mockListRuns).not.toHaveBeenCalled();
    },
  );

  it.each<BillStatus>(["approved", "paid"])("has one on a %s bill", async (status) => {
    mockListPayments.mockResolvedValue(status === "paid" ? [payment()] : []);
    await openPage(status);

    expect(screen.getByRole("heading", { name: "Payment", level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(mockListPayments).toHaveBeenCalledWith("bill-123"));
    expect(mockListRuns).toHaveBeenCalledWith("bill-123");
  });

  it("comes last, after the invoice document", async () => {
    await openPage("approved");

    const document = screen.getByRole("heading", { name: "Invoice Document" });
    const payment = screen.getByRole("heading", { name: "Payment" });
    expect(document.compareDocumentPosition(payment)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("on an approved bill", () => {
  it.each<Role>(["approver", "admin"])(
    "offers an active %s both Mark as paid and Pay with AI in the section",
    async (role) => {
      await openPage("approved", role);

      const section = paymentSection();
      expect(
        await within(section).findByRole("button", { name: "Mark as paid" }),
      ).toBeInTheDocument();
      expect(
        await within(section).findByRole("button", { name: "Pay with AI" }),
      ).toBeInTheDocument();
      expect(within(section).getByRole("heading", { name: "Payment history" })).toBeVisible();
      expect(within(section).getByRole("heading", { name: "AI payment" })).toBeVisible();
    },
  );

  it("shows an analyst nothing to do, so the section has no panels", async () => {
    await openPage("approved", "analyst");
    await waitFor(() => expect(mockListRuns).toHaveBeenCalled());
    await waitFor(() => expect(mockListPayments).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
    // The row of panels is empty, which hides the whole section (CSS :has).
    const row = screen.getByRole("heading", { name: "Payment" }).nextElementSibling;
    expect(row).toBeEmptyDOMElement();
  });

  it("shows an analyst the payment history, still with no buttons", async () => {
    mockListPayments.mockResolvedValue([
      payment({ payment_status: "failed", failure_reason: "Bank returned it", reference: null }),
    ]);
    await openPage("approved", "analyst");

    const section = paymentSection();
    expect(await within(section).findByRole("list", { name: "Payment history" })).toHaveTextContent(
      "Bank returned it",
    );
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives an inactive approver no buttons", async () => {
    signInAs("approver", "inactive");
    mockGetBill.mockResolvedValue(bill("approved"));
    render(<InvoiceDetailPage />);
    await screen.findByRole("heading", { name: "INV-1001" });
    await waitFor(() => expect(mockListRuns).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });
});

describe("on a paid bill", () => {
  it("shows the payment history and the latest run, read-only", async () => {
    mockListPayments.mockResolvedValue([payment()]);
    mockListRuns.mockResolvedValue([paidRun]);
    await openPage("paid", "admin");

    const section = paymentSection();
    expect(await within(section).findByRole("list", { name: "Payment history" })).toHaveTextContent(
      "Completed",
    );
    expect(await within(section).findByText("CONF-778")).toBeInTheDocument();
    expect(within(section).getByText(/^Started .* by Pat Lee$/)).toBeInTheDocument();
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("when a panel finds the bill paid", () => {
  it("reloads the bill after Mark as paid, so the status and section follow", async () => {
    const user = userEvent.setup();
    mockRecordPayment.mockResolvedValue(payment());
    await openPage("approved");
    expect(within(headerStatus()).getByText("approved")).toBeInTheDocument();

    mockGetBill.mockResolvedValue(bill("paid"));
    mockListPayments.mockResolvedValue([payment()]);
    await user.click(await screen.findByRole("button", { name: "Mark as paid" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as paid" }),
    );

    expect(await within(headerStatus()).findByText("paid")).toBeInTheDocument();
    expect(mockGetBill).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });

  it("reloads the bill when a Pay with AI run ends paid", async () => {
    jest.useFakeTimers();
    try {
      mockListRuns.mockResolvedValue([run()]);
      mockGetRun.mockResolvedValue(paidRun);
      await openPage("approved");
      expect(await screen.findByText("Paying on the portal")).toBeInTheDocument();

      mockGetBill.mockResolvedValue(bill("paid"));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      expect(await within(headerStatus()).findByText("paid")).toBeInTheDocument();
      expect(mockGetBill).toHaveBeenCalledTimes(2);
      expect(screen.getByText("CONF-778")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the bill on screen when the reload fails", async () => {
    const user = userEvent.setup();
    mockRecordPayment.mockResolvedValue(payment());
    await openPage("approved");

    mockGetBill.mockRejectedValue(new Error("Unable to load invoice."));
    mockListPayments.mockResolvedValue([payment()]);
    await user.click(await screen.findByRole("button", { name: "Mark as paid" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as paid" }),
    );

    await waitFor(() => expect(mockGetBill).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: "INV-1001" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(paymentSection()).getByText("Paid on Nov 14, 2026")).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ApiError } from "@/lib/api/http";
import { listPayments, recordPayment } from "@/lib/api/payments";
import type { Payment } from "@/types/payment";
import type { UserRole, UserStatus } from "@/types/user";
import { BillPayments } from "./BillPayments";
import { localToday } from "./payment-form";

// The real module reads the Supabase session and calls the backend.
jest.mock("@/lib/api/payments", () => ({
  listPayments: jest.fn(),
  recordPayment: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockListPayments = jest.mocked(listPayments);
const mockRecordPayment = jest.mocked(recordPayment);

function signIn(role: UserRole, status: UserStatus = "active") {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1" },
    profile: { id: "user-1", full_name: "Jane Doe", email: "jane@example.test", role, status },
    profileError: null,
    loading: false,
  });
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    bill_id: "bill-1",
    amount: "1250.00",
    payment_method: "ach",
    payment_status: "completed",
    paid_on: "2026-11-14",
    reference: "CONF-1",
    failure_reason: null,
    attempt_number: 1,
    recorded_by: "user-1",
    created_at: "2026-11-14T18:00:00Z",
    ...overrides,
  };
}

const failedAttempt = payment({
  id: "pay-0",
  payment_status: "failed",
  payment_method: "check",
  paid_on: "2026-11-10",
  reference: null,
  failure_reason: "Bank returned it",
});

function renderPayments(props: Partial<ComponentProps<typeof BillPayments>> = {}) {
  return render(
    <BillPayments billId="bill-1" billAmount="1250.00" billStatus="approved" {...props} />,
  );
}

function markAsPaidButton() {
  return screen.getByRole("button", { name: "Mark as paid" });
}

async function openDialog(user = userEvent.setup()) {
  await user.click(await screen.findByRole("button", { name: "Mark as paid" }));
  return screen.getByRole("dialog", { name: "Mark as paid" });
}

beforeEach(() => {
  jest.clearAllMocks();
  signIn("approver");
  mockListPayments.mockResolvedValue([]);
});

describe("who can mark a bill as paid", () => {
  it.each<UserRole>(["approver", "admin"])("shows the button to an active %s", async (role) => {
    signIn(role);
    renderPayments();

    expect(await screen.findByRole("button", { name: "Mark as paid" })).toBeInTheDocument();
  });

  it.each<[UserRole, UserStatus]>([
    ["analyst", "active"],
    ["approver", "inactive"],
    ["admin", "inactive"],
  ])("never shows it to a %s who is %s", async (role, status) => {
    signIn(role, status);
    mockListPayments.mockResolvedValue([failedAttempt]);
    renderPayments();

    expect(await screen.findByRole("list", { name: "Payment history" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });

  it("hides it while the account is still loading", async () => {
    mockUseAuth.mockReturnValue({ user: null, profile: null, profileError: null, loading: true });
    renderPayments();

    await waitFor(() => expect(mockListPayments).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });

  it.each(["pending_approval", "rejected", "draft"] as const)(
    "hides it on a %s bill, and renders nothing with no payments",
    async (billStatus) => {
      const { container } = renderPayments({ billStatus });

      await waitFor(() => expect(mockListPayments).toHaveBeenCalledWith("bill-1"));
      expect(container).toBeEmptyDOMElement();
    },
  );
});

describe("payment history", () => {
  it("lists every attempt, newest first, with the reason a payment failed", async () => {
    signIn("analyst");
    mockListPayments.mockResolvedValue([payment(), failedAttempt]);
    renderPayments({ billStatus: "paid" });

    const list = await screen.findByRole("list", { name: "Payment history" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(
      "$1,250.00Nov 14, 2026 \u00b7 ACH \u00b7 Reference CONF-1Completed",
    );
    expect(items[1]).toHaveTextContent("$1,250.00Nov 10, 2026 \u00b7 CheckFailedBank returned it");
  });

  it("shows a paid bill as paid, with the date it was paid", async () => {
    mockListPayments.mockResolvedValue([payment()]);
    renderPayments({ billStatus: "paid" });

    expect(await screen.findByText("Paid on Nov 14, 2026")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });

  it("reads the history again when the bill is paid elsewhere, such as by Pay with AI", async () => {
    const { rerender } = renderPayments();
    await waitFor(() => expect(mockListPayments).toHaveBeenCalledTimes(1));
    mockListPayments.mockResolvedValue([payment()]);

    rerender(<BillPayments billId="bill-1" billAmount="1250.00" billStatus="paid" />);

    expect(await screen.findByText("Paid on Nov 14, 2026")).toBeInTheDocument();
    expect(mockListPayments).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("list", { name: "Payment history" })).toHaveTextContent("Completed");
  });

  it("offers a retry when the history can't be loaded", async () => {
    mockListPayments.mockRejectedValueOnce(new Error("Unable to load payments (500)"));
    mockListPayments.mockResolvedValueOnce([failedAttempt]);
    const user = userEvent.setup();
    renderPayments();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load payments (500)");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Bank returned it")).toBeInTheDocument();
    expect(mockListPayments).toHaveBeenCalledTimes(2);
  });
});

describe("the mark as paid dialog", () => {
  it("shows the full amount read-only, ACH and today's date by default", async () => {
    renderPayments({ billAmount: 1250.5 });
    const dialog = await openDialog();

    expect(within(dialog).getByText("$1,250.50")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /amount/i })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Payment method")).toHaveValue("ach");
    expect(within(dialog).getByLabelText("Date paid")).toHaveValue(localToday());
    expect(within(dialog).getByLabelText("Reference")).toHaveValue("");
    expect(within(dialog).queryByLabelText("What went wrong")).not.toBeInTheDocument();
  });

  it("sends a completed payment for the bill amount", async () => {
    const user = userEvent.setup();
    mockRecordPayment.mockResolvedValue(payment({ paid_on: "2026-11-12" }));
    renderPayments();
    const dialog = await openDialog(user);

    await user.selectOptions(within(dialog).getByLabelText("Payment method"), "check");
    await user.clear(within(dialog).getByLabelText("Date paid"));
    await user.type(within(dialog).getByLabelText("Date paid"), "2026-11-12");
    await user.type(within(dialog).getByLabelText("Reference"), " 10442 ");
    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    expect(mockRecordPayment).toHaveBeenCalledWith("bill-1", {
      amount: "1250.00",
      payment_method: "check",
      paid_on: "2026-11-12",
      reference: "10442",
      outcome: "completed",
    });
  });

  it("closes and shows the bill as paid after a completed payment", async () => {
    const user = userEvent.setup();
    const onPaid = jest.fn();
    const recorded = payment({ paid_on: "2026-11-15" });
    mockRecordPayment.mockResolvedValue(recorded);
    renderPayments({ onPaid });
    await openDialog(user);
    mockListPayments.mockResolvedValue([recorded]);

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as paid" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const paidState = screen.getByText("Paid on Nov 15, 2026").parentElement;
    expect(paidState).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(onPaid).toHaveBeenCalledWith(recorded);
    await waitFor(() => expect(mockListPayments).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("list", { name: "Payment history" })).toHaveTextContent("Completed");
  });

  it("records a failed attempt with its reason and leaves the bill payable", async () => {
    const user = userEvent.setup();
    const onPaid = jest.fn();
    const recorded = payment({
      id: "pay-2",
      payment_status: "failed",
      reference: null,
      failure_reason: "Card declined",
    });
    mockRecordPayment.mockResolvedValue(recorded);
    renderPayments({ onPaid });
    const dialog = await openDialog(user);

    await user.click(
      within(dialog).getByRole("button", { name: "Record a failed attempt instead" }),
    );
    expect(dialog).toHaveAccessibleName("Record a failed attempt");
    expect(within(dialog).getByLabelText("What went wrong")).toHaveFocus();
    await user.type(within(dialog).getByLabelText("What went wrong"), "Card declined");
    await user.click(within(dialog).getByRole("button", { name: "Record failed attempt" }));

    expect(mockRecordPayment).toHaveBeenCalledWith("bill-1", {
      amount: "1250.00",
      payment_method: "ach",
      paid_on: localToday(),
      reference: null,
      outcome: "failed",
      failure_reason: "Card declined",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Payment history" })).toHaveTextContent(
      "FailedCard declined",
    );
    expect(markAsPaidButton()).toHaveFocus();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("requires a reason for a failed attempt before sending it", async () => {
    const user = userEvent.setup();
    renderPayments();
    const dialog = await openDialog(user);

    await user.click(
      within(dialog).getByRole("button", { name: "Record a failed attempt instead" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Record failed attempt" }));

    expect(within(dialog).getByLabelText("What went wrong")).toHaveAccessibleDescription(
      "Say what went wrong.",
    );
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it("refuses a date in the future", async () => {
    const user = userEvent.setup();
    renderPayments();
    const dialog = await openDialog(user);

    await user.clear(within(dialog).getByLabelText("Date paid"));
    await user.type(within(dialog).getByLabelText("Date paid"), "2099-01-01");
    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    expect(within(dialog).getByLabelText("Date paid")).toHaveAccessibleDescription(
      "The date can't be in the future.",
    );
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it("disables the buttons and ignores Escape and the backdrop while saving", async () => {
    const user = userEvent.setup();
    let finish: (value: Payment) => void = () => {};
    mockRecordPayment.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderPayments();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    expect(within(dialog).getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByLabelText("Close dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockRecordPayment).toHaveBeenCalledTimes(1);

    finish(payment());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the server's message on a 409, refreshes and stops offering the button", async () => {
    const user = userEvent.setup();
    const onPaid = jest.fn();
    const paidElsewhere = payment({ id: "pay-9", paid_on: "2026-11-13" });
    mockRecordPayment.mockRejectedValue(new ApiError("This bill has already been paid.", 409));
    renderPayments({ onPaid });
    const dialog = await openDialog(user);
    mockListPayments.mockResolvedValue([paidElsewhere]);

    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("This bill has already been paid.");
    expect(within(dialog).getByRole("button", { name: "Mark as paid" })).toBeDisabled();
    expect(await screen.findByText("Paid on Nov 13, 2026")).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledWith(paidElsewhere);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });

  it("explains a 409 for a bill that is no longer approved", async () => {
    const user = userEvent.setup();
    const message = "Only approved bills can be paid. This bill is rejected.";
    mockRecordPayment.mockRejectedValue(new ApiError(message, 409));
    renderPayments();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    await waitFor(() => expect(mockListPayments).toHaveBeenCalledTimes(2));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });

  it("shows the server's message on a 422 and lets the user try again", async () => {
    const user = userEvent.setup();
    const message = "A completed payment must be for the full bill amount (1300.00).";
    mockRecordPayment.mockRejectedValue(new ApiError(message, 422));
    renderPayments();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(message);
    expect(within(dialog).getByRole("button", { name: "Mark as paid" })).toBeEnabled();
    expect(mockListPayments).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a server error", new ApiError("Unable to record the payment (500)", 500)],
    ["an unreachable server", new Error("Unable to reach the server.")],
  ])("shows a plain retry message for %s", async (_name, error) => {
    const user = userEvent.setup();
    mockRecordPayment.mockRejectedValue(error);
    renderPayments();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Unable to save the payment. Try again.",
    );
    expect(within(dialog).getByRole("button", { name: "Mark as paid" })).toBeEnabled();
  });
});

describe("dialog keyboard and focus", () => {
  it("moves focus into the dialog and back to the button on Escape", async () => {
    const user = userEvent.setup();
    renderPayments();
    const dialog = await openDialog(user);

    expect(within(dialog).getByLabelText("Payment method")).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markAsPaidButton()).toHaveFocus();
  });

  it("closes from the backdrop and from Cancel", async () => {
    const user = userEvent.setup();
    renderPayments();

    await openDialog(user);
    await user.click(screen.getByLabelText("Close dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    renderPayments();
    const dialog = await openDialog(user);
    const submit = within(dialog).getByRole("button", { name: "Mark as paid" });

    submit.focus();
    await user.tab();
    expect(within(dialog).getByLabelText("Payment method")).toHaveFocus();

    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
  });

  it("starts again from the defaults each time it opens", async () => {
    const user = userEvent.setup();
    renderPayments();
    let dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText("Reference"), "abc");
    await user.click(
      within(dialog).getByRole("button", { name: "Record a failed attempt instead" }),
    );
    await user.keyboard("{Escape}");
    dialog = await openDialog(user);

    expect(dialog).toHaveAccessibleName("Mark as paid");
    expect(within(dialog).getByLabelText("Reference")).toHaveValue("");
  });
});

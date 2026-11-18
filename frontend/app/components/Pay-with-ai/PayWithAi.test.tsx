import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError } from "@/lib/api/http";
import { getPaymentRun, listPaymentRuns, startPaymentRun } from "@/lib/api/payment-runs";
import type { BillStatus } from "@/types/bill";
import type { PaymentRun, PaymentRunStep } from "@/types/payment-run";
import PayWithAi from "./PayWithAi";
import { pollDelay } from "./usePaymentRuns";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/api/payment-runs", () => ({
  startPaymentRun: jest.fn(),
  listPaymentRuns: jest.fn(),
  getPaymentRun: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockList = listPaymentRuns as jest.Mock;
const mockStart = startPaymentRun as jest.Mock;
const mockGet = getPaymentRun as jest.Mock;

const ME = "user-me";

function step(stepName: string, detail: string, at = "2026-11-15T15:00:00Z"): PaymentRunStep {
  return { at, step: stepName, detail };
}

const QUEUED_STEP = step("queued", "Queued by Pat Lee.");
const SIGNED_IN = step(
  "sign_in",
  "Signed in to https://portal.example.com.",
  "2026-11-15T15:00:05Z",
);

function run(overrides: Partial<PaymentRun> = {}): PaymentRun {
  return {
    id: "run-1",
    bill_id: "bill-1",
    started_by: "user-pat",
    started_by_name: "Pat Lee",
    trigger: "manual",
    status: "queued",
    steps: [QUEUED_STEP],
    flag_reason: null,
    receipt: null,
    payment_id: null,
    created_at: "2026-11-15T15:00:00Z",
    started_at: null,
    finished_at: null,
    updated_at: "2026-11-15T15:00:00Z",
    ...overrides,
  };
}

const RECEIPT = {
  confirmation_number: "CONF-778",
  bill_number: "INV-1",
  amount: "1234.5",
  paid_on: "2026-11-15",
  outcome: "successful" as const,
  portal: "https://portal.example.com",
};

const paidRun = run({
  status: "paid",
  steps: [QUEUED_STEP, SIGNED_IN, step("finished", "Run ended: paid.", "2026-11-15T15:01:00Z")],
  receipt: RECEIPT,
  payment_id: "payment-1",
  started_at: "2026-11-15T15:00:01Z",
  finished_at: "2026-11-15T15:01:00Z",
});

function signInAs(
  role: "admin" | "analyst" | "approver" | null,
  { status = "active", loading = false }: { status?: string; loading?: boolean } = {},
) {
  mockUseAuth.mockReturnValue({
    profile: role ? { id: ME, role, status, full_name: "Me", email: "me@example.com" } : null,
    loading,
  });
}

function renderPay(props: { billStatus?: BillStatus; onPaid?: () => void } = {}) {
  return render(
    <PayWithAi billId="bill-1" billStatus={props.billStatus ?? "approved"} onPaid={props.onPaid} />,
  );
}

// Runs every timer due in the next `ms` and lets the polls they start answer.
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function liveRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[aria-live="polite"]');
  if (!region) throw new Error("no live region");
  return region;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
  signInAs("approver");
});

afterEach(() => {
  jest.useRealTimers();
});

const user = () => userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

describe("who sees the button", () => {
  it.each(["approver", "admin"] as const)(
    "shows Pay with AI to an active %s on an approved bill",
    async (role) => {
      signInAs(role);
      renderPay();

      expect(await screen.findByRole("button", { name: "Pay with AI" })).toBeEnabled();
      expect(
        screen.getByText(
          "Claude signs in to the vendor's portal and pays this bill. You can watch each step.",
        ),
      ).toBeInTheDocument();
    },
  );

  it("renders nothing for an analyst when the bill has no runs", async () => {
    signInAs("analyst");
    const { container } = renderPay();

    await advance(0);
    expect(mockList).toHaveBeenCalledWith("bill-1");
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an analyst the latest run and history read-only", async () => {
    signInAs("analyst");
    const flagged = run({
      id: "run-0",
      status: "flagged",
      flag_reason: "The portal does not list INV-1. Nothing was paid.",
      finished_at: "2026-11-14T10:00:00Z",
      created_at: "2026-11-14T09:59:00Z",
    });
    mockList.mockResolvedValue([paidRun, flagged]);
    renderPay({ billStatus: "paid" });

    expect(await screen.findByText("CONF-778")).toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "Earlier runs" })
      .parentElement as HTMLElement;
    expect(within(history).getByText("flagged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });

  it("hides the button from an analyst even on an approved bill with a failed run", async () => {
    signInAs("analyst");
    mockList.mockResolvedValue([run({ status: "failed", finished_at: "2026-11-15T15:01:00Z" })]);
    renderPay();

    expect(await screen.findByText("The portal declined the payment")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });

  it.each([
    ["an inactive approver", () => signInAs("approver", { status: "inactive" })],
    ["a profile still loading", () => signInAs(null, { loading: true })],
  ])("hides the button from %s", async (_name, setUp) => {
    setUp();
    mockList.mockResolvedValue([paidRun]);
    renderPay();

    await screen.findByText("CONF-778");
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });

  it.each<BillStatus>(["pending_approval", "paid", "rejected"])(
    "hides the button when the bill is %s",
    async (billStatus) => {
      const { container } = renderPay({ billStatus });

      await advance(0);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("hides the button once the latest run is paid, even if the bill status is stale", async () => {
    mockList.mockResolvedValue([paidRun]);
    renderPay();

    await screen.findByText("CONF-778");
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });

  it("offers the button again after a failed run, since the bill stays approved", async () => {
    mockList.mockResolvedValue([run({ status: "failed", finished_at: "2026-11-15T15:01:00Z" })]);
    renderPay();

    expect(await screen.findByRole("button", { name: "Pay with AI" })).toBeInTheDocument();
  });
});

describe("starting a run", () => {
  it("asks for confirmation and does nothing on Cancel", async () => {
    renderPay();
    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));

    const dialog = screen.getByRole("dialog", { name: "Start a payment run for this bill?" });
    await user().click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("POSTs on Start and shows the queued run in place of the button", async () => {
    mockStart.mockResolvedValue(run());
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPay();

    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));
    await user().click(screen.getByRole("button", { name: "Start" }));

    expect(mockStart).toHaveBeenCalledWith("bill-1");
    expect(await screen.findByText("Waiting for the worker")).toBeInTheDocument();
    expect(screen.getByText("Queued by Pat Lee.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });

  it("disables the button while the POST is in flight", async () => {
    mockStart.mockReturnValue(new Promise(() => {}));
    renderPay();

    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));
    await user().click(screen.getByRole("button", { name: "Start" }));

    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
  });

  it("shows a 422 message in place of the button with what to do", async () => {
    mockStart.mockRejectedValue(
      new ApiError(
        "The vendor account has no portal login. Add the portal URL, email and password first.",
        422,
      ),
    );
    renderPay();

    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));
    await user().click(screen.getByRole("button", { name: "Start" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The vendor account has no portal login. Add the portal URL, email and password first.",
    );
    expect(alert).toHaveTextContent(
      "Claude can't pay this bill until that's fixed. Then try again.",
    );
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();

    await user().click(within(alert).getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a 409 for a bill that is no longer approved and reloads the runs", async () => {
    mockStart.mockRejectedValue(
      new ApiError("Only approved bills can be paid. This bill is rejected.", 409),
    );
    renderPay();

    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));
    await user().click(screen.getByRole("button", { name: "Start" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Only approved bills can be paid. This bill is rejected.");
    expect(alert).toHaveTextContent("Reload the page to see this bill's latest status.");
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("follows the run someone else started when the start is a 409", async () => {
    mockStart.mockRejectedValue(
      new ApiError("A payment run is already in progress for this bill.", 409),
    );
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPay();
    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));

    mockList.mockResolvedValue([run({ status: "running", steps: [QUEUED_STEP, SIGNED_IN] })]);
    await user().click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText("Paying on the portal")).toBeInTheDocument();
    mockGet.mockResolvedValue(run({ status: "failed", finished_at: "2026-11-15T15:01:00Z" }));
    await advance(2000);
    expect(mockGet).toHaveBeenCalledWith("run-1", expect.any(AbortSignal));

    // That run ended: the button is back, not the old 409 message.
    expect(screen.getByText("The portal declined the payment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay with AI" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a network error with no extra help", async () => {
    mockStart.mockRejectedValue(new Error("Unable to reach the server."));
    renderPay();

    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));
    await user().click(screen.getByRole("button", { name: "Start" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to reach the server.");
    expect(alert).not.toHaveTextContent("Reload the page");
  });
});

describe("polling a run", () => {
  async function startRun() {
    mockStart.mockResolvedValue(run());
    await user().click(await screen.findByRole("button", { name: "Pay with AI" }));
    await user().click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Waiting for the worker");
  }

  it("re-reads the run every 2 seconds, showing each new step, until it is paid", async () => {
    const onPaid = jest.fn();
    renderPay({ onPaid });
    await startRun();

    mockGet.mockResolvedValueOnce(run({ status: "running", steps: [QUEUED_STEP, SIGNED_IN] }));
    await advance(1999);
    expect(mockGet).not.toHaveBeenCalled();
    await advance(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Paying on the portal")).toBeInTheDocument();
    expect(
      within(liveRegion()).getByText("Signed in to https://portal.example.com."),
    ).toBeVisible();
    expect(onPaid).not.toHaveBeenCalled();

    mockGet.mockResolvedValueOnce(paidRun);
    await advance(2000);
    expect(mockGet).toHaveBeenCalledTimes(2);

    const region = liveRegion();
    expect(within(region).getByText("Paid")).toBeInTheDocument();
    expect(within(region).getByText("CONF-778")).toBeInTheDocument();
    expect(within(region).getByText("$1,234.50")).toBeInTheDocument();
    expect(within(region).getByText("Nov 15, 2026")).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);

    await advance(30_000);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("stops on failed and says the bill stays approved", async () => {
    const onPaid = jest.fn();
    renderPay({ onPaid });
    await startRun();

    mockGet.mockResolvedValueOnce(
      run({
        status: "failed",
        receipt: { ...RECEIPT, outcome: "declined", confirmation_number: "DECL-9" },
        finished_at: "2026-11-15T15:01:00Z",
      }),
    );
    await advance(2000);

    expect(within(liveRegion()).getByText("The portal declined the payment")).toBeInTheDocument();
    expect(screen.getByText("Nothing was paid and the bill stays approved.")).toBeInTheDocument();
    expect(screen.getByText("Portal reference: DECL-9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay with AI" })).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();

    await advance(10_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("stops on flagged and shows the reason with the steps", async () => {
    renderPay();
    await startRun();

    const reason = "The portal already shows INV-1 on account 7 as paid. Nothing was paid.";
    mockGet.mockResolvedValueOnce(
      run({
        status: "flagged",
        flag_reason: reason,
        steps: [QUEUED_STEP, SIGNED_IN, step("flagged", reason, "2026-11-15T15:00:09Z")],
        finished_at: "2026-11-15T15:00:10Z",
      }),
    );
    await advance(2000);

    const region = liveRegion();
    expect(within(region).getByText("Needs a person")).toBeInTheDocument();
    // The reason once in the panel and once as the flag step, never glued to the title.
    expect(within(region).getAllByText(reason)).toHaveLength(2);
    expect(within(region).queryByText(/Needs a person:/)).not.toBeInTheDocument();
    const steps = within(region).getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(within(steps).getByText("Signed in to https://portal.example.com.")).toBeVisible();

    await advance(10_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("backs off after failed polls, says so, and recovers", async () => {
    renderPay();
    await startRun();

    mockGet.mockRejectedValue(new Error("Unable to reach the server."));
    await advance(2000);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Can't reach the server right now. Still trying.")).toBeInTheDocument();

    await advance(3999);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mockGet).toHaveBeenCalledTimes(2);

    mockGet.mockResolvedValue(run({ status: "running" }));
    await advance(8000);
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByText("Can't reach the server right now. Still trying."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Paying on the portal")).toBeInTheDocument();

    await advance(2000);
    expect(mockGet).toHaveBeenCalledTimes(4);
  });

  it("stops polling and aborts the request in flight on unmount", async () => {
    const { unmount } = renderPay();
    await startRun();

    mockGet.mockReturnValue(new Promise(() => {}));
    await advance(2000);
    expect(mockGet).toHaveBeenCalledTimes(1);
    const signal = mockGet.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
    await advance(30_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("never polls after unmounting between polls", async () => {
    const { unmount } = renderPay();
    await startRun();

    unmount();
    await advance(30_000);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("on load", () => {
  it("resumes polling a run that is still running, with earlier runs as history", async () => {
    const earlierFailed = run({
      id: "run-0",
      status: "failed",
      started_by: ME,
      created_at: "2026-11-14T09:00:00Z",
      finished_at: "2026-11-14T09:01:00Z",
    });
    mockList.mockResolvedValue([
      run({ status: "running", steps: [QUEUED_STEP, SIGNED_IN] }),
      earlierFailed,
    ]);
    mockGet.mockResolvedValue(paidRun);
    const onPaid = jest.fn();
    renderPay({ onPaid });

    expect(await screen.findByText("Paying on the portal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();

    const history = screen.getByRole("heading", { name: "Earlier runs" })
      .parentElement as HTMLElement;
    expect(within(history).getByText("failed")).toBeInTheDocument();
    expect(within(history).getByText(/^Started .* by you$/)).toBeInTheDocument();
    expect(within(history).getByText(/^Finished /)).toBeInTheDocument();

    await advance(2000);
    expect(mockGet).toHaveBeenCalledWith("run-1", expect.any(AbortSignal));
    expect(await screen.findByText("CONF-778")).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("names who started the latest run from their account, not the step text", async () => {
    mockList.mockResolvedValue([run({ steps: [step("queued", "Queued by Someone Else.")] })]);
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPay();

    expect(await screen.findByText(/^Started .* by Pat Lee$/)).toBeInTheDocument();
  });

  it("leaves the name out when the run has none", async () => {
    mockList.mockResolvedValue([run({ started_by_name: null })]);
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPay();

    expect(await screen.findByText(/^Started /)).not.toHaveTextContent(/ by /);
  });

  it("does not call onPaid for a run that was already paid", async () => {
    mockList.mockResolvedValue([paidRun]);
    const onPaid = jest.fn();
    renderPay({ onPaid });

    await screen.findByText("CONF-778");
    await advance(10_000);
    expect(mockGet).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("keeps a paid run's steps behind a disclosure", async () => {
    mockList.mockResolvedValue([paidRun]);
    renderPay();

    const toggle = await screen.findByText("Show steps (3)");
    // The open state's label; CSS shows one of the two depending on the disclosure.
    expect(toggle.closest("summary")).toHaveTextContent("Hide steps");
    expect(screen.getByText("Signed in to https://portal.example.com.")).not.toBeVisible();
    await user().click(toggle);
    expect(screen.getByText("Signed in to https://portal.example.com.")).toBeVisible();
  });

  it("shows a load error with a retry", async () => {
    mockList.mockRejectedValueOnce(new Error("Unable to load payment runs (500)"));
    renderPay();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load payment runs (500)");
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();

    await user().click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Pay with AI" })).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("shows a loading line to a payer while the runs load", async () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderPay();

    expect(screen.getByRole("status")).toHaveTextContent("Loading payment runs...");
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();
  });
});

describe("autopay runs", () => {
  const AUTOPAY_LINE = "Autopay started this run after approval.";
  const autopayStep = step("queued", "Queued by autopay after approval by Pat Lee.");

  it("says autopay started the latest run, and follows it live", async () => {
    mockList.mockResolvedValue([run({ trigger: "autopay", steps: [autopayStep] })]);
    mockGet.mockResolvedValue(run({ trigger: "autopay", status: "running" }));
    renderPay();

    const region = liveRegion();
    expect(await within(region).findByText(AUTOPAY_LINE)).toBeInTheDocument();
    // Started by autopay, not by the approver whose name is in the first step.
    expect(within(region).getByText(/^Started /)).not.toHaveTextContent(/ by /);
    expect(within(region).getByText(autopayStep.detail)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with AI" })).not.toBeInTheDocument();

    await advance(2000);
    expect(mockGet).toHaveBeenCalledWith("run-1", expect.any(AbortSignal));
    expect(within(region).getByText("Paying on the portal")).toBeInTheDocument();
    expect(within(region).getByText(AUTOPAY_LINE)).toBeInTheDocument();
  });

  it("says so for an earlier autopay run too", async () => {
    const earlierAutopay = run({
      id: "run-0",
      trigger: "autopay",
      status: "flagged",
      flag_reason: "The portal does not list INV-1. Nothing was paid.",
      created_at: "2026-11-14T09:00:00Z",
      finished_at: "2026-11-14T09:01:00Z",
    });
    mockList.mockResolvedValue([paidRun, earlierAutopay]);
    renderPay();

    await screen.findByText("CONF-778");
    const history = screen.getByRole("heading", { name: "Earlier runs" })
      .parentElement as HTMLElement;
    expect(within(history).getByText(AUTOPAY_LINE)).toBeInTheDocument();
    expect(within(liveRegion()).queryByText(AUTOPAY_LINE)).not.toBeInTheDocument();
  });

  it("never says it for a run someone started", async () => {
    mockList.mockResolvedValue([paidRun, run({ id: "run-0", status: "failed" })]);
    renderPay();

    await screen.findByText("CONF-778");
    expect(screen.queryByText(AUTOPAY_LINE)).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("labels the section and keeps one polite live region mounted before any run", async () => {
    renderPay();

    expect(await screen.findByRole("region", { name: "AI payment" })).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it("puts the current state and each step, with its time, inside the live region", async () => {
    mockList.mockResolvedValue([run({ status: "running", steps: [QUEUED_STEP, SIGNED_IN] })]);
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPay();

    await screen.findByText("Paying on the portal");
    const region = liveRegion();
    expect(within(region).getByText("Paying on the portal")).toBeInTheDocument();
    const items = within(within(region).getByRole("list", { name: "Steps" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    const time = items[1].querySelector("time");
    expect(time).toHaveAttribute("dateTime", SIGNED_IN.at);
    expect(time?.textContent).toMatch(/^\d{1,2}:\d{2}:\d{2} [AP]M$/);
  });
});

describe("pollDelay", () => {
  it("waits 2 s, doubles after each failure in a row, and caps at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(pollDelay)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});

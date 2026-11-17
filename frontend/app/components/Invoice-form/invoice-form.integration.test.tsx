import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, useSyncExternalStore } from "react";
import { extractBill, getBillDraft, saveBillDraft, submitBill } from "@/lib/api/bills";
import type { ExtractionResult } from "@/types/extraction";
import { InvoiceForm } from "./invoice-form";

// The real hooks and the real form together; only the API layer and the
// router are mocked.

const push = jest.fn();

type MockRouter = { pathname: string; bfcacheId: string; shown: boolean };
let mockRouter: MockRouter;
const mockListeners = new Set<() => void>();

function mockSetRouter(change: Partial<MockRouter>) {
  mockRouter = { ...mockRouter, ...change };
  for (const listener of mockListeners) listener();
}

function useMockRouter(): MockRouter {
  return useSyncExternalStore(
    (listener) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
    () => mockRouter,
  );
}

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, bfcacheId: useMockRouter().bfcacheId }),
  usePathname: () => useMockRouter().pathname,
}));

const nativeReplaceState = window.history.replaceState.bind(window.history);
jest.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
  nativeReplaceState(data, unused, url);
  if (url) act(() => mockSetRouter({ pathname: new URL(url, window.location.href).pathname }));
});

jest.mock("@/lib/api/bills", () => ({
  extractBill: jest.fn(),
  getBillDraft: jest.fn(),
  saveBillDraft: jest.fn(),
  submitBill: jest.fn(),
  updateBillDraft: jest.fn(),
  uploadInvoicePdf: jest.fn(),
}));

// The vendor account lookup never answers here; its own tests are in
// invoice-form-vendor-account.test.tsx.
jest.mock("@/lib/api/vendor-account-lookup", () => ({
  lookUpVendorAccounts: jest.fn(() => new Promise<never>(() => {})),
}));

const mockExtractBill = jest.mocked(extractBill);
const mockSaveBillDraft = jest.mocked(saveBillDraft);
const mockSubmitBill = jest.mocked(submitBill);

// A page the person leaves stays mounted inside a hidden <Activity>.
function RoutedForm() {
  const { shown } = useMockRouter();
  return (
    <Activity mode={shown ? "visible" : "hidden"}>
      <InvoiceForm />
    </Activity>
  );
}

function pdf() {
  return new File(["%PDF-1.4"], "invoice.pdf", { type: "application/pdf" });
}

function dropZone() {
  return screen.getByText("Upload / import invoice (PDF)").closest("label") as HTMLElement;
}

function extractionResult(): ExtractionResult {
  const read = (value: string | null) => ({ value, evidence: value ?? "", confidence: "high" });
  return {
    status: "ready_for_review",
    extraction: {
      document_type: "invoice",
      vendor_name: read("City Power"),
      account_number: read("ACC-100"),
      invoice_number: read("INV-2001"),
      invoice_date: read("2026-10-01"),
      due_date: read("2026-10-31"),
      amount_due: read("250.00"),
      previous_balance: read(null),
      payments_received: read(null),
      current_charges: read(null),
      line_items: [],
      service_address: read("12 Elm St"),
      service_period_start: read(null),
      service_period_end: read(null),
      description: read(null),
      payment_website: read(null),
      account_status: read(null),
    },
    issues: [],
    failed_reason: null,
    model: "test-model",
    prompt_version: "v1",
    file_sha256: "abc",
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0,
    latency_ms: 1,
  } as ExtractionResult;
}

async function saveDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Bill Description / Explanation"), "Power");
  await user.click(screen.getByRole("button", { name: "Save Draft" }));
  await screen.findByRole("button", { name: "Draft Saved ✓" });
  expect(screen.getByText("Draft saved successfully: bill-1")).toBeInTheDocument();
}

describe("InvoiceForm with its real hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter = { pathname: "/invoices/new", bfcacheId: "_b_0_", shown: true };
    mockExtractBill.mockReturnValue(new Promise<never>(() => {}));
    mockSaveBillDraft.mockResolvedValue({
      bill_id: "bill-1",
      status: "draft",
      document_path: null,
    });
  });

  it("keeps the form without reloading the draft when the first save moves the URL", async () => {
    const user = userEvent.setup();
    render(<InvoiceForm />);
    await saveDraft(user);

    expect(mockRouter.pathname).toBe("/invoices/bill-1/edit");
    expect(getBillDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
    expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("Power");
  });

  it("marks a saved draft unsaved when a field changes", async () => {
    const user = userEvent.setup();
    render(<InvoiceForm />);
    await saveDraft(user);

    await user.type(screen.getByLabelText("Account / Customer #"), "ACC-100");

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    expect(screen.queryByText("Draft saved successfully: bill-1")).not.toBeInTheDocument();
  });

  it("marks a saved draft unsaved when the read fills it", async () => {
    const user = userEvent.setup();
    let resolveRead!: (result: ExtractionResult) => void;
    mockExtractBill.mockReturnValue(
      new Promise<ExtractionResult>((resolve) => {
        resolveRead = resolve;
      }),
    );
    render(<InvoiceForm />);
    await saveDraft(user);

    fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });
    await act(async () => resolveRead(extractionResult()));

    expect(screen.getByLabelText("Account / Customer #")).toHaveValue("ACC-100");
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    expect(screen.queryByText("Draft saved successfully: bill-1")).not.toBeInTheDocument();
  });

  it("clears the draft saved message when Create starts", async () => {
    const user = userEvent.setup();
    mockSubmitBill.mockRejectedValue(new Error("Server unavailable"));
    render(<InvoiceForm />);
    await user.type(screen.getByLabelText("Account / Customer #"), "ACC-100");
    await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
    await user.type(screen.getByLabelText("Customer / Business Name"), "City Power");
    await user.type(screen.getByLabelText("Property Address"), "12 Elm St");
    await user.type(screen.getByLabelText("Issue / Record / Invoice Date"), "2026-10-01");
    await user.type(screen.getByLabelText("Due / Pay Date"), "2026-10-31");
    await user.type(screen.getByLabelText("Current Due"), "250.00");
    await saveDraft(user);

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Server unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Draft saved successfully: bill-1")).not.toBeInTheDocument();
  });

  it("does not leave a stopped read showing as reading", () => {
    render(<RoutedForm />);
    fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });
    expect(screen.getByText("Reading invoice...")).toBeInTheDocument();

    act(() => mockSetRouter({ pathname: "/dashboard", shown: false }));
    expect((mockExtractBill.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    act(() => mockSetRouter({ pathname: "/invoices/new", shown: true }));

    expect(screen.queryByText("Reading invoice...")).not.toBeInTheDocument();
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
  });
});

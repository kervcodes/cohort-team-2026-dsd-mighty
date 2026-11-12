import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, useSyncExternalStore } from "react";
import {
  extractBill,
  getBillDraft,
  saveBillDraft,
  submitBill,
  updateBillDraft,
  uploadInvoicePdf,
} from "@/lib/api/bills";
import { ApiError } from "@/lib/api/http";
import { accountStatuses } from "@/lib/invoice-form-schema";
import type { AccountStatus, Bill, BillDraftDetail } from "@/types/bill";
import type {
  BillExtraction,
  Confidence,
  Extracted,
  ExtractedAccountStatus,
  ExtractionResult,
} from "@/types/extraction";
import { InvoiceForm } from "./invoice-form";

const push = jest.fn();

// The App Router as the form sees it, kept to what Next documents:
// - usePathname follows the URL, including native history.replaceState.
// - useRouter().bfcacheId changes when a link or router.push/replace creates
//   the page's segment afresh, and stays the same on back/forward, and when a
//   link targets the route tree already rendered.
// - A page the person leaves stays mounted inside a hidden <Activity>
//   (`shown` below), keeping its state.
type MockRouter = { pathname: string; bfcacheId: string; shown: boolean };
let mockRouter: MockRouter;
let mockFreshSegments = 0;
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

// Next patches history.replaceState so usePathname follows it.
const nativeReplaceState = window.history.replaceState.bind(window.history);
jest.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
  nativeReplaceState(data, unused, url);
  if (url) act(() => mockSetRouter({ pathname: new URL(url, window.location.href).pathname }));
});

// A link or router.push to another page: this one is hidden, not unmounted.
function leaveTo(pathname: string) {
  act(() => mockSetRouter({ pathname, shown: false }));
}

// A link or router.push into this page from another one: a fresh segment.
function arriveByLink(pathname: string) {
  mockFreshSegments += 1;
  act(() => mockSetRouter({ pathname, shown: true, bfcacheId: `_b_${mockFreshSegments}_` }));
}

// Back or forward to this page: Next restores its bfcacheId.
function goBackTo(pathname: string) {
  act(() => mockSetRouter({ pathname, shown: true }));
}

// A link whose route tree is the one already rendered: Next reuses the
// segment, so the bfcacheId stays.
function linkWithinRoute(pathname: string) {
  act(() => mockSetRouter({ pathname }));
}

function RoutedForm() {
  const { shown } = useMockRouter();
  return (
    <Activity mode={shown ? "visible" : "hidden"}>
      <InvoiceForm />
    </Activity>
  );
}

// The real module needs NEXT_PUBLIC_API_URL at import time and makes network
// calls; the form is tested in isolation.
// Only these exist on the mock: the form calling anything else (such as
// createBill, which makes a second bill) fails the test.
jest.mock("@/lib/api/bills", () => ({
  extractBill: jest.fn(),
  getBillDraft: jest.fn(),
  saveBillDraft: jest.fn(),
  submitBill: jest.fn(),
  updateBillDraft: jest.fn(),
  uploadInvoicePdf: jest.fn(),
}));

function pdf(name = "invoice.pdf", type = "application/pdf") {
  return new File(["%PDF-1.4"], name, { type });
}

const mockSaveBillDraft = saveBillDraft as jest.MockedFunction<typeof saveBillDraft>;
const mockUpdateBillDraft = updateBillDraft as jest.MockedFunction<typeof updateBillDraft>;
const mockUploadInvoicePdf = uploadInvoicePdf as jest.MockedFunction<typeof uploadInvoicePdf>;
const mockSubmitBill = submitBill as jest.MockedFunction<typeof submitBill>;

const mockGetBillDraft = getBillDraft as jest.MockedFunction<typeof getBillDraft>;
const mockExtractBill = extractBill as jest.MockedFunction<typeof extractBill>;

function read(value: string | null, confidence: Confidence = "high"): Extracted {
  return { value, evidence: value ?? "", confidence };
}

function status(
  value: AccountStatus | null,
  confidence: Confidence = "high",
): ExtractedAccountStatus {
  return { value, evidence: value ?? "", confidence };
}

function extraction(overrides: Partial<BillExtraction> = {}): BillExtraction {
  return {
    document_type: "invoice",
    vendor_name: read("City Power"),
    account_number: read("ACC-100"),
    invoice_number: read("INV-2001"),
    invoice_date: read("2026-10-01"),
    due_date: read("2026-10-31"),
    amount_due: read("$1,234.56"),
    previous_balance: read(null),
    payments_received: read("50.00"),
    current_charges: read(null),
    line_items: [],
    service_address: read("12 Elm St"),
    service_period_start: read(null),
    service_period_end: read(null),
    // Most tests are about the bill's required fields; the ones on these
    // three set them.
    description: read(null),
    payment_website: read(null),
    account_status: status(null),
    ...overrides,
  };
}

function extractionResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    status: "ready_for_review",
    extraction: extraction(),
    issues: [],
    failed_reason: null,
    model: "test-model",
    prompt_version: "v1",
    file_sha256: "abc",
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0,
    latency_ms: 1,
    ...overrides,
  };
}

// A read the test finishes when it chooses.
function pendingRead() {
  let resolve!: (result: ExtractionResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ExtractionResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A saved draft with every field Create requires.
function fullDraft(overrides: Partial<BillDraftDetail> = {}): BillDraftDetail {
  return {
    bill_id: "bill-1",
    status: "draft",
    account_number_raw: "ACC-100",
    invoice_number: "INV-2001",
    vendor_name_raw: "City Power",
    invoice_date: "2026-10-01",
    due_date: "2026-10-31",
    amount: "250.00",
    prev_payments: null,
    description: "Electricity",
    processing_notes: null,
    property_address: "12 Elm St",
    account_status: null,
    website_name: null,
    document_path: null,
    ...overrides,
  };
}

function dropZone() {
  return screen.getByText("Upload / import invoice (PDF)").closest("label") as HTMLElement;
}

describe("InvoiceForm", () => {
  beforeEach(() => {
    push.mockClear();
    (window.history.replaceState as jest.Mock).mockClear();
    mockRouter = { pathname: "/invoices/new", bfcacheId: "_b_0_", shown: true };
    mockGetBillDraft.mockReset().mockReturnValue(new Promise<never>(() => {}));
    // Reads never finish unless a test says so: most tests are not about them.
    mockExtractBill.mockReset().mockReturnValue(new Promise<never>(() => {}));
  });

  it("renders every field by its label", () => {
    render(<InvoiceForm />);

    [
      "Account / Customer #",
      "Statement / Bill ID",
      "Customer / Business Name",
      "Property Address",
      "Issue / Record / Invoice Date",
      "Due / Pay Date",
      "Bill Description / Explanation",
      "Prev Payments",
      "Current Due",
      "Account Status",
      "Payment / Processing Notes (optional)",
      "Website Name (optional)",
    ].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  it("offers an option for every account status", () => {
    render(<InvoiceForm />);

    accountStatuses.forEach((status: string) => {
      const optionName = status || "Select status";
      expect(screen.getByRole("option", { name: optionName })).toBeInTheDocument();
    });
  });

  it("shows validation errors and does not navigate when submitted empty", async () => {
    const user = userEvent.setup();
    const { container } = render(<InvoiceForm />);

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(container.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
    });
    expect(push).not.toHaveBeenCalled();
  });

  describe("PDF drag and drop", () => {
    it("selects a dropped PDF", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

      expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    });

    it("accepts a .pdf file with an empty MIME type", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), {
        dataTransfer: { files: [pdf("scan.PDF", "")] },
      });

      expect(screen.getByText("scan.PDF")).toBeInTheDocument();
    });

    it("rejects a dropped non-PDF file", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), {
        dataTransfer: {
          files: [new File(["x"], "photo.png", { type: "image/png" })],
        },
      });

      expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files can be uploaded.");
      expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    });

    it("rejects dropping more than one file", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), {
        dataTransfer: { files: [pdf("a.pdf"), pdf("b.pdf")] },
      });

      expect(screen.getByRole("alert")).toHaveTextContent("Drop one PDF at a time.");
    });

    it("highlights the zone while a file is dragged over it", () => {
      render(<InvoiceForm />);
      // Look the zone up once: its text changes while dragging.
      const zone = dropZone();

      fireEvent.dragOver(zone, { dataTransfer: { dropEffect: "none" } });
      expect(screen.getByText("Drop the PDF here")).toBeInTheDocument();

      fireEvent.dragLeave(zone, { relatedTarget: document.body });
      expect(screen.getByText("Upload / import invoice (PDF)")).toBeInTheDocument();
    });

    it("still accepts a PDF from the file picker", async () => {
      const user = userEvent.setup();
      const { container } = render(<InvoiceForm />);

      await user.upload(container.querySelector("#invoicePdf") as HTMLInputElement, pdf());

      expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    });
  });

  describe("Storing the PDF with the draft", () => {
    const savedDraft = {
      bill_id: "bill-1",
      status: "draft" as const,
      document_path: null,
    };
    const stored = { bill_id: "bill-1", document_path: "bills/bill-1/x.pdf", status: "draft" };

    beforeEach(() => {
      mockSaveBillDraft.mockReset().mockResolvedValue(savedDraft);
      mockUpdateBillDraft.mockReset().mockResolvedValue(savedDraft);
      mockUploadInvoicePdf.mockReset().mockResolvedValue(stored);
    });

    async function saveDraft(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: /Save Draft|Draft Saved|Retry Save/ }));
    }

    it("has no Upload PDF button", () => {
      render(<InvoiceForm />);
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

      expect(screen.queryByRole("button", { name: /Upload/ })).not.toBeInTheDocument();
    });

    it("says a picked PDF is stored on the next save", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("harborlight-bill.pdf")] } });

      expect(
        screen.getByText(
          "harborlight-bill.pdf is stored when you save the draft or create the bill.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Stored with this draft/)).not.toBeInTheDocument();
    });

    it("stores the picked PDF with the draft once, then shows it as stored", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);
      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      const file = pdf("harborlight-bill.pdf");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

      await saveDraft(user);
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      // The values are saved first: the PDF needs the draft's id.
      expect(mockSaveBillDraft.mock.invocationCallOrder[0]).toBeLessThan(
        mockUploadInvoicePdf.mock.invocationCallOrder[0],
      );
      expect(screen.getByText("Stored with this draft: harborlight-bill.pdf")).toHaveAttribute(
        "role",
        "status",
      );

      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Water");
      await saveDraft(user);
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockUpdateBillDraft).toHaveBeenCalledTimes(1);
      // The same file is not stored again.
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(1);
    });

    it("replaces the stored PDF when another one is picked and saved", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);
      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("first.pdf")] } });
      await saveDraft(user);
      await screen.findByText("Stored with this draft: first.pdf");

      const second = pdf("second.pdf");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [second] } });

      // A new pick is an unsaved change.
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
      expect(
        screen.getByText(
          "second.pdf replaces the stored PDF when you save the draft or create the bill.",
        ),
      ).toBeInTheDocument();

      await saveDraft(user);
      await screen.findByText("Stored with this draft: second.pdf");

      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
      expect(mockUploadInvoicePdf).toHaveBeenLastCalledWith(second, "bill-1");
    });

    it("keeps the draft when the PDF can't be stored, and retries on the next save", async () => {
      const user = userEvent.setup();
      mockUploadInvoicePdf.mockRejectedValueOnce(new Error("Unable to store the invoice PDF."));
      render(<InvoiceForm />);
      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      const file = pdf("harborlight-bill.pdf");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

      await saveDraft(user);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Draft saved, but the PDF couldn't be stored. Save again to retry.",
      );
      expect(alert).toHaveTextContent("Unable to store the invoice PDF.");
      expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
      expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/invoices/bill-1/edit");
      expect(screen.queryByText(/Stored with this draft/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Retry Save" }));
      await screen.findByText("Stored with this draft: harborlight-bill.pdf");

      // The retry updates the same draft and stores the same file.
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUpdateBillDraft).toHaveBeenCalledWith("bill-1", expect.anything());
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
      expect(mockUploadInvoicePdf).toHaveBeenLastCalledWith(file, "bill-1");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("saves only the values when no PDF is picked", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);
      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      await saveDraft(user);
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(screen.getByText("Draft saved successfully: bill-1")).toBeInTheDocument();
      expect(screen.queryByText(/Stored with this draft/)).not.toBeInTheDocument();
    });
  });

  describe("Create", () => {
    const savedDraft = {
      bill_id: "bill-1",
      status: "draft" as const,
      document_path: null,
    };
    const submitted = { id: "bill-1", status: "pending_approval" } as Bill;
    const stored = { bill_id: "bill-1", document_path: "bills/bill-1/x.pdf", status: "draft" };

    beforeEach(() => {
      mockSaveBillDraft.mockReset().mockResolvedValue(savedDraft);
      mockUpdateBillDraft.mockReset().mockResolvedValue(savedDraft);
      mockUploadInvoicePdf.mockReset().mockResolvedValue(stored);
      mockSubmitBill.mockReset().mockResolvedValue(submitted);
    });

    // Every field Create requires, valid.
    function fillInValidBill() {
      const values: Record<string, string> = {
        "Account / Customer #": "ACC-100",
        "Statement / Bill ID": "INV-2001",
        "Customer / Business Name": "City Power",
        "Property Address": "12 Elm St",
        "Issue / Record / Invoice Date": "2026-10-01",
        "Due / Pay Date": "2026-10-31",
        "Bill Description / Explanation": "Electricity",
        "Current Due": "250.00",
      };
      for (const [label, value] of Object.entries(values)) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      }
    }

    const finalValues = {
      account_number_raw: "ACC-100",
      invoice_number: "INV-2001",
      vendor_name_raw: "City Power",
      property_address: "12 Elm St",
      invoice_date: "2026-10-01",
      due_date: "2026-10-31",
      description: "Electricity",
      amount: "250.00",
    };

    async function create(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: /Create/ }));
    }

    it("creates a draft, stores the PDF on it, then submits that draft", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);
      fillInValidBill();
      const file = pdf("harborlight-bill.pdf");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

      await create(user);

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockSaveBillDraft.mock.calls[0][0]).toMatchObject(finalValues);
      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(mockSubmitBill).toHaveBeenCalledTimes(1);
      expect(mockSubmitBill).toHaveBeenCalledWith("bill-1", expect.objectContaining(finalValues));
      const [saveOrder] = mockSaveBillDraft.mock.invocationCallOrder;
      const [uploadOrder] = mockUploadInvoicePdf.mock.invocationCallOrder;
      const [submitOrder] = mockSubmitBill.mock.invocationCallOrder;
      expect(saveOrder).toBeLessThan(uploadOrder);
      expect(uploadOrder).toBeLessThan(submitOrder);
      expect(screen.getByRole("button", { name: "Created ✓" })).toBeDisabled();
    });

    it("submits the draft Save Draft made, without storing its PDF again", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);
      fillInValidBill();
      const file = pdf();
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });
      fireEvent.change(screen.getByLabelText("Current Due"), { target: { value: "275.00" } });

      await create(user);

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(1);
      // The final values go with the submit itself.
      expect(mockSubmitBill).toHaveBeenCalledWith(
        "bill-1",
        expect.objectContaining({ amount: "275.00" }),
      );
    });

    it("submits without storing anything when no PDF was picked", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);
      fillInValidBill();

      await create(user);

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(mockSubmitBill).toHaveBeenCalledWith("bill-1", expect.objectContaining(finalValues));
    });

    it("submits an opened draft, keeping the PDF stored before", async () => {
      const user = userEvent.setup();
      mockRouter = { ...mockRouter, pathname: "/invoices/bill-7/edit" };
      mockGetBillDraft.mockResolvedValue(fullDraft({ bill_id: "bill-7" }));
      render(<InvoiceForm />);
      await screen.findByDisplayValue("ACC-100");

      await create(user);

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(mockSubmitBill).toHaveBeenCalledWith("bill-7", expect.objectContaining(finalValues));
    });

    it("stays on the form when the submit fails, and a retry submits the same draft", async () => {
      const user = userEvent.setup();
      mockSubmitBill.mockRejectedValueOnce(new Error("Unable to reach the server."));
      render(<InvoiceForm />);
      fillInValidBill();
      const file = pdf();
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

      await create(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
      expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/invoices/bill-1/edit");

      await user.click(screen.getByRole("button", { name: "Retry Create" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      // One draft, one stored PDF, and both submits for that draft.
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(1);
      expect(mockSubmitBill.mock.calls.map(([id]) => id)).toEqual(["bill-1", "bill-1"]);
    });

    it("goes to the dashboard when a retry finds the draft already submitted", async () => {
      const user = userEvent.setup();
      // The first submit reached the server but its answer was lost.
      mockSubmitBill
        .mockRejectedValueOnce(new Error("Unable to reach the server."))
        .mockRejectedValueOnce(new ApiError("This bill has already been submitted.", 409));
      render(<InvoiceForm />);
      fillInValidBill();

      await create(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");

      await user.click(screen.getByRole("button", { name: "Retry Create" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(screen.queryByText("This bill has already been submitted.")).not.toBeInTheDocument();
    });

    it("still shows other submit errors, such as a missing draft", async () => {
      const user = userEvent.setup();
      mockSubmitBill.mockRejectedValueOnce(new ApiError("Editable draft not found.", 404));
      render(<InvoiceForm />);
      fillInValidBill();

      await create(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("Editable draft not found.");
      expect(push).not.toHaveBeenCalled();
    });

    it("does not submit when the PDF can't be stored, and a retry continues", async () => {
      const user = userEvent.setup();
      mockUploadInvoicePdf.mockRejectedValueOnce(new Error("Unable to store the invoice PDF."));
      render(<InvoiceForm />);
      fillInValidBill();
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

      await create(user);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The PDF couldn't be stored, so the bill wasn't created.");
      expect(alert).toHaveTextContent("Unable to store the invoice PDF.");
      expect(mockSubmitBill).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Retry Create" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
      expect(mockSubmitBill).toHaveBeenCalledTimes(1);
    });

    it("stays on the form when the draft can't be created", async () => {
      const user = userEvent.setup();
      mockSaveBillDraft.mockRejectedValueOnce(new Error("Unable to save draft"));
      render(<InvoiceForm />);
      fillInValidBill();

      await create(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save draft");
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Retry Create" })).toBeEnabled();
    });

    it("shows one loading state and blocks Save Draft while creating", async () => {
      const user = userEvent.setup();
      mockSubmitBill.mockReturnValue(new Promise<never>(() => {}));
      render(<InvoiceForm />);
      fillInValidBill();

      await create(user);

      expect(await screen.findByRole("button", { name: "Creating..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });
  });

  describe("Save Draft", () => {
    const savedDraft = {
      bill_id: "bill-1",
      status: "draft" as const,
      document_path: null,
    };

    beforeEach(() => {
      mockSaveBillDraft.mockReset().mockResolvedValue(savedDraft);
      mockUpdateBillDraft.mockReset().mockResolvedValue(savedDraft);
    });

    it("creates the draft first, then updates the same bill on later saves", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Current Due"), "250.00");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockSaveBillDraft.mock.calls[0][0]).toMatchObject({
        amount: "250.00",
      });
      expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/invoices/bill-1/edit");

      const amount = screen.getByLabelText("Current Due");
      await user.clear(amount);
      await user.type(amount, "275.00");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUpdateBillDraft).toHaveBeenCalledWith(
        "bill-1",
        expect.objectContaining({ amount: "275.00" }),
      );
    });

    it("sends blank fields as null so an update can clear them", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      const payload = mockSaveBillDraft.mock.calls[0][0];
      expect(payload.amount).toBeNull();
      expect(payload.due_date).toBeNull();
      expect(payload.prev_payments).toBeNull();
    });

    it("marks the draft unsaved when a field changes", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Account / Customer #"), "ACC-100");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("marks the draft unsaved when a PDF is picked, as Save Draft stores it", async () => {
      const user = userEvent.setup();
      mockUploadInvoicePdf.mockReset();
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Account / Customer #"), "ACC-100");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      await user.upload(document.querySelector("#invoicePdf") as HTMLInputElement, pdf());
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });
    it("saves a draft holding only a picked PDF and stores the PDF with it", async () => {
      const user = userEvent.setup();
      mockUploadInvoicePdf.mockReset().mockResolvedValue({
        bill_id: "bill-1",
        document_path: "bills/bill-1/x.pdf",
        status: "draft",
      });
      const file = pdf();
      render(<InvoiceForm />);

      await user.upload(document.querySelector("#invoicePdf") as HTMLInputElement, file);
      const saveDraft = screen.getByRole("button", { name: "Save Draft" });
      expect(saveDraft).toBeEnabled();

      await user.click(saveDraft);
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
    });

    it("disables Save Draft until the user enters something", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("keeps Save Draft disabled when a field only contains spaces", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "   ");

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });

    it("disables Save Draft again when the user clears the only field", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      const field = screen.getByLabelText("Statement / Bill ID");
      await user.type(field, "INV-2001");
      await user.clear(field);

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });

    it("does not call the API when the disabled button is clicked", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Save Draft" }));

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
    });
  });

  describe("Load Draft", () => {
    beforeEach(() => {
      mockRouter = { ...mockRouter, pathname: "/invoices/bill-1/edit" };
    });

    it("loads an existing draft and populates the form", async () => {
      mockGetBillDraft.mockResolvedValue({
        bill_id: "bill-1",
        status: "draft",
        account_number_raw: "ACC-100",
        invoice_number: "INV-2001",
        vendor_name_raw: "Electric Company",
        invoice_date: "2026-10-01",
        due_date: "2026-11-01",
        amount: "250.00",
        prev_payments: "50.00",
        description: "Monthly electricity",
        processing_notes: "Pay online",
        property_address: "123 Main Street",
        account_status: "unpaid",
        website_name: "electric.example.com",
        document_path: null,
      });

      render(<InvoiceForm />);

      await waitFor(() => {
        expect(mockGetBillDraft).toHaveBeenCalledWith("bill-1");
      });

      expect(await screen.findByDisplayValue("ACC-100")).toBeInTheDocument();
      expect(screen.getByDisplayValue("INV-2001")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Electric Company")).toBeInTheDocument();
      expect(screen.getByDisplayValue("250.00")).toBeInTheDocument();
      expect(screen.getByDisplayValue("50.00")).toBeInTheDocument();
      expect(screen.getByDisplayValue("123 Main Street")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Monthly electricity")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Pay online")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2026-10-01")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2026-11-01")).toBeInTheDocument();
      expect(screen.getByLabelText("Account Status")).toHaveValue("unpaid");
      expect(screen.getByDisplayValue("electric.example.com")).toBeInTheDocument();
    });

    it("shows that the opened draft already has a stored PDF", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft({ document_path: "bills/bill-1/abc.pdf" }));

      render(<InvoiceForm />);

      expect(await screen.findByText("A PDF is stored with this draft.")).toHaveAttribute(
        "role",
        "status",
      );

      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("newer.pdf")] } });

      expect(screen.queryByText("A PDF is stored with this draft.")).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "newer.pdf replaces the stored PDF when you save the draft or create the bill.",
        ),
      ).toBeInTheDocument();
    });

    it("shows no stored PDF for a draft without one", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft());

      render(<InvoiceForm />);
      await screen.findByDisplayValue("ACC-100");

      expect(screen.queryByText(/stored/)).not.toBeInTheDocument();
    });

    it("enables Save Draft once an existing draft has loaded", async () => {
      mockGetBillDraft.mockResolvedValue({
        bill_id: "bill-1",
        status: "draft",
        account_number_raw: "ACC-100",
        invoice_number: null,
        vendor_name_raw: null,
        invoice_date: null,
        due_date: null,
        amount: null,
        prev_payments: null,
        description: null,
        processing_notes: null,
        property_address: null,
        account_status: null,
        website_name: null,
        document_path: null,
      });

      render(<InvoiceForm />);
      expect(await screen.findByDisplayValue("ACC-100")).toBeInTheDocument();

      expect(await screen.findByRole("button", { name: "Save Draft" })).toBeEnabled();
    });
  });
  describe("Coming back to the page", () => {
    const draft = {
      bill_id: "bill-1",
      status: "draft" as const,
      account_number_raw: "ACC-100",
      invoice_number: "INV-2001",
      vendor_name_raw: null,
      invoice_date: null,
      due_date: null,
      amount: null,
      prev_payments: null,
      description: null,
      processing_notes: null,
      property_address: null,
      account_status: null,
      website_name: null,
      document_path: null,
    };

    beforeEach(() => {
      mockSaveBillDraft.mockReset().mockResolvedValue({
        bill_id: "bill-1",
        status: "draft",
        document_path: null,
      });
      mockUpdateBillDraft.mockReset();
    });

    // A form with a value typed, a PDF read and its banner and notes, and a
    // validation error.
    async function fillIn(user: ReturnType<typeof userEvent.setup>) {
      mockExtractBill.mockResolvedValueOnce(
        extractionResult({
          status: "needs_attention",
          extraction: extraction({ amount_due: read("1,18") }),
          issues: [{ code: "BAD_AMOUNT", field: "amount_due", message: "bad" }],
        }),
      );
      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Power");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("a.pdf")] } });
      expect(await screen.findByText(/Some values need checking/)).toBeInTheDocument();
      expect(screen.getByText(/Check this/)).toBeInTheDocument();
    }

    function expectFreshNewInvoice() {
      expect(screen.getByRole("heading", { name: "New Invoice" })).toBeInTheDocument();
      expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("");
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("");
      expect(screen.getByText("Drag and drop a PDF here, or click to browse")).toBeInTheDocument();
      expect(screen.queryByText(/Some values need checking/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Check this/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Draft saved successfully/)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    }

    it("starts a fresh New Invoice after Cancel and a link back", async () => {
      const user = userEvent.setup();
      render(<RoutedForm />);
      await fillIn(user);

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(push).toHaveBeenCalledWith("/dashboard");
      leaveTo("/dashboard");
      arriveByLink("/invoices/new");

      expectFreshNewInvoice();
    });

    it("keeps the form as it was after back and forward", async () => {
      const user = userEvent.setup();
      render(<RoutedForm />);
      await fillIn(user);

      leaveTo("/dashboard");
      goBackTo("/invoices/new");

      expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("Power");
      expect(screen.getByText("a.pdf")).toBeInTheDocument();
      expect(screen.getByText(/Some values need checking/)).toBeInTheDocument();
    });

    it("does not leave a stopped read showing as reading", () => {
      render(<RoutedForm />);
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

      leaveTo("/dashboard");
      expect((mockExtractBill.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
      goBackTo("/invoices/new");

      expect(screen.queryByText("Reading invoice...")).not.toBeInTheDocument();
      expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    });

    it("keeps the picked PDF and banner when the first save moves the URL", async () => {
      const user = userEvent.setup();
      render(<RoutedForm />);
      await fillIn(user);

      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      expect(mockRouter.pathname).toBe("/invoices/bill-1/edit");
      expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
      expect(screen.getByText("a.pdf")).toBeInTheDocument();
      expect(screen.getByText(/Some values need checking/)).toBeInTheDocument();
      expect(mockGetBillDraft).not.toHaveBeenCalled();
    });

    it("starts a fresh New Invoice from a link after Save Draft", async () => {
      const user = userEvent.setup();
      render(<RoutedForm />);
      await fillIn(user);
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      // Next's route tree is still /invoices/new after replaceState.
      linkWithinRoute("/invoices/new");

      expectFreshNewInvoice();
      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });
      // A new draft, not an update of the first one.
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(2);
      expect(mockUpdateBillDraft).not.toHaveBeenCalled();
    });

    it("loads the saved draft when back returns to its URL", async () => {
      const user = userEvent.setup();
      mockGetBillDraft.mockResolvedValue(draft);
      render(<RoutedForm />);
      await user.type(screen.getByLabelText("Account / Customer #"), "ACC-100");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });
      linkWithinRoute("/invoices/new");

      goBackTo("/invoices/bill-1/edit");

      expect(await screen.findByDisplayValue("INV-2001")).toBeInTheDocument();
      expect(mockGetBillDraft).toHaveBeenCalledWith("bill-1");
      expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
    });

    it("loads Edit Draft afresh from the server each time a link opens it", async () => {
      const user = userEvent.setup();
      mockRouter = { ...mockRouter, pathname: "/invoices/bill-1/edit" };
      mockGetBillDraft.mockResolvedValueOnce(draft);
      render(<RoutedForm />);
      await screen.findByDisplayValue("ACC-100");
      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Unsaved");
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("a.pdf")] } });

      leaveTo("/dashboard");
      mockGetBillDraft.mockResolvedValueOnce({ ...draft, account_number_raw: "ACC-200" });
      arriveByLink("/invoices/bill-1/edit");

      expect(await screen.findByDisplayValue("ACC-200")).toBeInTheDocument();
      expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("");
      expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
      expect(mockGetBillDraft).toHaveBeenCalledTimes(2);
    });

    it("keeps unsaved Edit Draft changes after back and forward", async () => {
      const user = userEvent.setup();
      mockRouter = { ...mockRouter, pathname: "/invoices/bill-1/edit" };
      mockGetBillDraft.mockResolvedValue(draft);
      render(<RoutedForm />);
      const account = await screen.findByDisplayValue("ACC-100");
      await user.clear(account);
      await user.type(account, "ACC-EDITED");

      leaveTo("/dashboard");
      goBackTo("/invoices/bill-1/edit");
      await act(async () => {});

      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("ACC-EDITED");
      expect(mockGetBillDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe("Reading the invoice", () => {
    function pick(file = pdf()) {
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });
    }

    it("reads a picked PDF and keeps the form usable while it reads", async () => {
      const user = userEvent.setup();
      const { container } = render(<InvoiceForm />);
      const file = pdf();

      await user.upload(container.querySelector("#invoicePdf") as HTMLInputElement, file);

      expect(mockExtractBill).toHaveBeenCalledWith(file, expect.any(AbortSignal));
      expect(screen.getByText("Reading invoice...")).toHaveAttribute("role", "status");
      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Power");
      expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("Power");
    });

    it("clears the picker so the same PDF can be picked again to retry", async () => {
      const user = userEvent.setup();
      const { container } = render(<InvoiceForm />);
      const input = container.querySelector("#invoicePdf") as HTMLInputElement;
      const file = pdf();

      await user.upload(input, file);

      // A browser fires no change event for a re-pick while the input still
      // holds that file, so an empty input is what makes a retry possible.
      expect(input.value).toBe("");
      expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    });

    it("reads a dropped PDF", () => {
      render(<InvoiceForm />);
      const file = pdf();

      pick(file);

      expect(mockExtractBill).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    });

    it("fills the empty fields and says how many", async () => {
      mockExtractBill.mockResolvedValue(extractionResult());
      render(<InvoiceForm />);

      pick();

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          "Filled 8 fields from the invoice. Check them before you create the bill.",
        );
      });
      expect(screen.queryByText("Reading invoice...")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("City Power");
      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("ACC-100");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
      expect(screen.getByLabelText("Issue / Record / Invoice Date")).toHaveValue("2026-10-01");
      expect(screen.getByLabelText("Due / Pay Date")).toHaveValue("2026-10-31");
      expect(screen.getByLabelText("Current Due")).toHaveValue("1234.56");
      expect(screen.getByLabelText("Prev Payments")).toHaveValue("50.00");
      expect(screen.getByLabelText("Property Address")).toHaveValue("12 Elm St");
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("fills Description, Website Name and Account Status, and replaces them from the next PDF", async () => {
      mockExtractBill
        .mockResolvedValueOnce(
          extractionResult({
            extraction: extraction({
              description: read("Electric service", "low"),
              payment_website: read("https://citypower.example/pay"),
              account_status: status("outstanding"),
            }),
          }),
        )
        .mockResolvedValueOnce(
          extractionResult({
            extraction: extraction({
              description: read("Water service"),
              payment_website: read("https://water.example"),
              account_status: status("paid"),
            }),
          }),
        );
      render(<InvoiceForm />);

      pick(pdf("a.pdf"));

      expect(
        await screen.findByText(
          "Filled 11 fields from the invoice. Check them before you create the bill.",
        ),
      ).toBeInTheDocument();
      const description = screen.getByLabelText("Bill Description / Explanation");
      expect(description).toHaveValue("Electric service");
      expect(description).toHaveAccessibleDescription("Check this: the reader wasn't sure");
      expect(screen.getByLabelText("Website Name (optional)")).toHaveValue(
        "https://citypower.example/pay",
      );
      const statusSelect = screen.getByLabelText("Account Status");
      expect(statusSelect).toHaveValue("outstanding");
      expect(statusSelect).toHaveDisplayValue("outstanding");

      pick(pdf("b.pdf"));

      await waitFor(() => {
        expect(statusSelect).toHaveDisplayValue("paid");
      });
      expect(description).toHaveValue("Water service");
      expect(description).not.toHaveAccessibleDescription();
      expect(screen.getByLabelText("Website Name (optional)")).toHaveValue("https://water.example");
    });

    it("keeps a typed description and notes a website it could not use", async () => {
      const user = userEvent.setup();
      mockExtractBill.mockResolvedValue(
        extractionResult({
          status: "needs_attention",
          extraction: extraction({
            description: read("Electric service"),
            payment_website: read("citypower.example/pay"),
            account_status: status("unpaid"),
          }),
          issues: [{ code: "BAD_URL", field: "payment_website", message: "not a URL" }],
        }),
      );
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Power bill");
      pick();

      expect(
        await screen.findByText(
          "Filled 9 fields from the invoice. Some values need checking - see the marked fields.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("Power bill");
      expect(screen.getByLabelText("Account Status")).toHaveValue("unpaid");
      const website = screen.getByLabelText("Website Name (optional)");
      expect(website).toHaveValue("");
      expect(website).toHaveAccessibleDescription(
        'Check this: read "citypower.example/pay", which isn\'t a valid web address',
      );
    });

    it("clears the Account Status note when the person picks a status, and keeps their pick", async () => {
      const user = userEvent.setup();
      mockExtractBill
        .mockResolvedValueOnce(
          extractionResult({ extraction: extraction({ account_status: status("paid", "low") }) }),
        )
        .mockResolvedValueOnce(
          extractionResult({ extraction: extraction({ account_status: status("outstanding") }) }),
        );
      render(<InvoiceForm />);

      pick(pdf("a.pdf"));

      const statusSelect = await screen.findByDisplayValue("paid");
      expect(statusSelect).toHaveAccessibleDescription("Check this: the reader wasn't sure");

      await user.selectOptions(statusSelect, "unpaid");

      expect(statusSelect).toHaveDisplayValue("unpaid");
      expect(screen.queryByText("Check this: the reader wasn't sure")).not.toBeInTheDocument();

      // The person's choice is theirs: the next read leaves it alone.
      pick(pdf("b.pdf"));
      await screen.findByText(
        "Filled 8 fields from the invoice. Check them before you create the bill.",
      );
      expect(statusSelect).toHaveDisplayValue("unpaid");
    });

    it("never overwrites a value typed before or during the read", async () => {
      const user = userEvent.setup();
      const read = pendingRead();
      mockExtractBill.mockReturnValue(read.promise);
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Account / Customer #"), "TYPED-1");
      pick();
      await user.type(screen.getByLabelText("Current Due"), "99.00");
      await act(async () => read.resolve(extractionResult()));

      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("TYPED-1");
      expect(screen.getByLabelText("Current Due")).toHaveValue("99.00");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
      expect(
        screen.getByText(
          "Filled 6 fields from the invoice. Check them before you create the bill.",
        ),
      ).toBeInTheDocument();
    });

    it("marks values that need checking, and editing one clears its note", async () => {
      const user = userEvent.setup();
      mockExtractBill.mockResolvedValue(
        extractionResult({
          status: "needs_attention",
          extraction: extraction({ amount_due: read("1,18") }),
          issues: [
            { code: "BAD_AMOUNT", field: "amount_due", message: "amount_due is not valid" },
            { code: "LOW_CONFIDENCE", field: "vendor_name", message: "low" },
            { code: "BALANCE_MISMATCH", field: "previous_balance", message: "x" },
          ],
        }),
      );
      render(<InvoiceForm />);

      pick();

      expect(
        await screen.findByText(
          "Filled 7 fields from the invoice. Some values need checking - see the marked fields.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Previous balance: the balance, payments and charges on the bill don't add up to it",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Current Due")).toHaveValue("");
      expect(screen.getByLabelText("Current Due")).toHaveAccessibleDescription(
        'Check this: read "1,18", which isn\'t a valid amount',
      );
      const vendor = screen.getByLabelText("Customer / Business Name");
      expect(vendor).toHaveAccessibleDescription("Check this: the reader wasn't sure");

      await user.type(vendor, " Co");

      expect(vendor).toHaveValue("City Power Co");
      expect(screen.queryByText("Check this: the reader wasn't sure")).not.toBeInTheDocument();
      expect(
        screen.getByText('Check this: read "1,18", which isn\'t a valid amount'),
      ).toBeInTheDocument();
    });

    it("fills nothing when the file is not a bill", async () => {
      mockExtractBill.mockResolvedValue(
        extractionResult({
          status: "not_an_invoice",
          extraction: extraction({ document_type: "not_an_invoice" }),
        }),
      );
      render(<InvoiceForm />);

      pick();

      expect(
        await screen.findByText("This file doesn't look like a bill. Fill in the form yourself."),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("This file doesn't look like a bill.");
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("");
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("shows why a failed read failed and fills nothing", async () => {
      mockExtractBill.mockResolvedValue(
        extractionResult({
          status: "failed",
          extraction: null,
          failed_reason: "The PDF is password protected.",
        }),
      );
      render(<InvoiceForm />);

      pick();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't read this invoice. Fill in the form yourself.");
      expect(alert).toHaveTextContent("The PDF is password protected.");
      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("");
    });

    it("shows an API error and keeps the form usable", async () => {
      const user = userEvent.setup();
      mockExtractBill.mockRejectedValue(
        new Error("Reading the bill took too long. Try again, or fill in the form."),
      );
      render(<InvoiceForm />);

      pick();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Reading the bill took too long. Try again, or fill in the form.",
      );
      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-1");
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("ignores the result of a file that was replaced while it was read", async () => {
      const first = pendingRead();
      const second = pendingRead();
      mockExtractBill.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      render(<InvoiceForm />);

      pick(pdf("old.pdf"));
      pick(pdf("new.pdf"));
      const firstSignal = mockExtractBill.mock.calls[0][1] as AbortSignal;
      expect(firstSignal.aborted).toBe(true);

      await act(async () =>
        first.resolve(
          extractionResult({ extraction: extraction({ vendor_name: read("Old Vendor") }) }),
        ),
      );
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("");
      expect(screen.getByText("Reading invoice...")).toBeInTheDocument();

      await act(async () =>
        second.resolve(
          extractionResult({ extraction: extraction({ vendor_name: read("New Vendor") }) }),
        ),
      );
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("New Vendor");
    });

    it("ignores the error of a replaced read", async () => {
      const first = pendingRead();
      mockExtractBill.mockReturnValueOnce(first.promise);
      render(<InvoiceForm />);

      pick(pdf("old.pdf"));
      pick(pdf("new.pdf"));
      await act(async () => first.reject(new Error("Unable to reach the server.")));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText("Reading invoice...")).toBeInTheDocument();
    });

    it("stops the read when the form unmounts", () => {
      const { unmount } = render(<InvoiceForm />);

      pick();
      unmount();

      expect((mockExtractBill.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    });

    it("stops the read when a non-PDF replaces the file", () => {
      render(<InvoiceForm />);

      pick();
      fireEvent.drop(dropZone(), {
        dataTransfer: { files: [new File(["x"], "photo.png", { type: "image/png" })] },
      });

      expect((mockExtractBill.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
      expect(screen.queryByText("Reading invoice...")).not.toBeInTheDocument();
      expect(mockExtractBill).toHaveBeenCalledTimes(1);
    });

    it("clears the last banner and notes when a new file is picked", async () => {
      mockExtractBill.mockResolvedValueOnce(
        extractionResult({
          status: "needs_attention",
          extraction: extraction({ invoice_date: read("10/01/2026") }),
          issues: [{ code: "BAD_DATE", field: "invoice_date", message: "bad" }],
        }),
      );
      render(<InvoiceForm />);

      pick(pdf("first.pdf"));
      expect(await screen.findByText(/Some values need checking/)).toBeInTheDocument();
      expect(screen.getByText(/Check this: read "10\/01\/2026"/)).toBeInTheDocument();

      pick(pdf("second.pdf"));

      expect(screen.queryByText(/Some values need checking/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Check this/)).not.toBeInTheDocument();
      expect(screen.getByText("Reading invoice...")).toBeInTheDocument();
    });

    it("marks a saved draft unsaved when the read fills it", async () => {
      const user = userEvent.setup();
      const read = pendingRead();
      mockExtractBill.mockReturnValue(read.promise);
      mockSaveBillDraft
        .mockReset()
        .mockResolvedValue({ bill_id: "bill-1", status: "draft", document_path: null });
      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Power");
      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      pick();
      await act(async () => read.resolve(extractionResult()));

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
      expect(screen.queryByText("Draft saved successfully: bill-1")).not.toBeInTheDocument();
    });

    it("clears a shown required error when the read fills that field", async () => {
      const user = userEvent.setup();
      const read = pendingRead();
      mockExtractBill.mockReturnValue(read.promise);
      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(await screen.findByText("Statement # is required")).toBeInTheDocument();

      pick();
      await act(async () => read.resolve(extractionResult()));

      await waitFor(() => {
        expect(screen.queryByText("Statement # is required")).not.toBeInTheDocument();
      });
      // A field the read did not fill keeps its error.
      expect(screen.getByText("Add a short description")).toBeInTheDocument();
    });

    it("replaces what the last read filled when another PDF is read", async () => {
      const user = userEvent.setup();
      mockExtractBill.mockResolvedValueOnce(extractionResult()).mockResolvedValueOnce(
        extractionResult({
          extraction: extraction({
            vendor_name: read("Water Co"),
            invoice_number: read("W-77"),
            amount_due: read("80.00"),
            payments_received: read(null),
            service_address: read(null),
          }),
        }),
      );
      render(<InvoiceForm />);

      pick(pdf("a.pdf"));
      await screen.findByText(/Filled 8 fields/);
      const account = screen.getByLabelText("Account / Customer #");
      await user.clear(account);
      await user.type(account, "MY-ACC");

      pick(pdf("b.pdf"));

      expect(
        await screen.findByText(
          "Filled 5 fields from the invoice. Check them before you create the bill.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("Water Co");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("W-77");
      expect(screen.getByLabelText("Current Due")).toHaveValue("80.00");
      // The person's edit stays; values B has nothing for are cleared.
      expect(account).toHaveValue("MY-ACC");
      expect(screen.getByLabelText("Prev Payments")).toHaveValue("");
      expect(screen.getByLabelText("Property Address")).toHaveValue("");
    });

    it("clears what the last read filled when the next read fails", async () => {
      const user = userEvent.setup();
      mockExtractBill
        .mockResolvedValueOnce(extractionResult())
        .mockRejectedValueOnce(new Error("Unable to reach the server."));
      render(<InvoiceForm />);

      pick(pdf("a.pdf"));
      await screen.findByText(/Filled 8 fields/);
      await user.type(screen.getByLabelText("Customer / Business Name"), " Co");

      pick(pdf("b.pdf"));

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("");
      expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("City Power Co");
    });

    it("never replaces values loaded from a saved draft", async () => {
      mockRouter = { ...mockRouter, pathname: "/invoices/bill-1/edit" };
      mockGetBillDraft.mockResolvedValue({
        bill_id: "bill-1",
        status: "draft",
        account_number_raw: "DRAFT-ACC",
        invoice_number: null,
        vendor_name_raw: null,
        invoice_date: null,
        due_date: null,
        amount: null,
        prev_payments: null,
        description: null,
        processing_notes: null,
        property_address: null,
        account_status: null,
        website_name: null,
        document_path: null,
      });
      mockExtractBill
        .mockResolvedValueOnce(extractionResult())
        .mockResolvedValueOnce(
          extractionResult({ extraction: extraction({ account_number: read("B-ACC") }) }),
        );
      render(<InvoiceForm />);
      await screen.findByDisplayValue("DRAFT-ACC");

      pick(pdf("a.pdf"));
      await screen.findByText(/Filled 7 fields/);
      pick(pdf("b.pdf"));
      await screen.findByText(/Filled 7 fields/);

      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("DRAFT-ACC");
    });
  });
});

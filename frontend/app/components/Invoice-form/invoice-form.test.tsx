import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  extractBill,
  getBill,
  getBillDraft,
  resubmitBill,
  saveBillDraft,
  submitBill,
  updateBillDraft,
  uploadInvoicePdf,
} from "@/lib/api/bills";
import { ApiError } from "@/lib/api/http";
import { accountStatuses } from "@/lib/invoice-form-schema";
import type { Bill, BillDraftDetail } from "@/types/bill";
import type {
  BillExtraction,
  Confidence,
  Extracted,
  ExtractedAccountStatus,
  ExtractionResult,
} from "@/types/extraction";
import { InvoiceForm } from "./invoice-form";

// --------------------------------------------------
// Router mocks
// --------------------------------------------------

const mockPush = jest.fn();

let mockPathname = "/invoices/new";
let mockInvoiceId: string | undefined;

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname,
  useParams: () => ({
    invoiceId: mockInvoiceId,
  }),
}));

// --------------------------------------------------
// API mocks
// --------------------------------------------------

jest.mock("@/lib/api/bills", () => ({
  extractBill: jest.fn(),
  getBill: jest.fn(),
  getBillDraft: jest.fn(),
  resubmitBill: jest.fn(),
  saveBillDraft: jest.fn(),
  submitBill: jest.fn(),
  updateBillDraft: jest.fn(),
  uploadInvoicePdf: jest.fn(),
}));

// Vendor lookup is covered by its own test suite.
jest.mock("./vendor-account-field", () => ({
  VendorAccountField: ({
    accountNumber,
    value,
    onChange,
  }: {
    accountNumber: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div>
      <label htmlFor="vendorAccountId">Vendor account</label>
      <input
        id="vendorAccountId"
        value={value}
        data-account-number={accountNumber}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));

// --------------------------------------------------
// Typed mocks
// --------------------------------------------------

const mockExtractBill = extractBill as jest.MockedFunction<typeof extractBill>;
const mockGetBill = getBill as jest.MockedFunction<typeof getBill>;
const mockGetBillDraft = getBillDraft as jest.MockedFunction<typeof getBillDraft>;
const mockResubmitBill = resubmitBill as jest.MockedFunction<typeof resubmitBill>;
const mockSaveBillDraft = saveBillDraft as jest.MockedFunction<typeof saveBillDraft>;
const mockSubmitBill = submitBill as jest.MockedFunction<typeof submitBill>;
const mockUpdateBillDraft = updateBillDraft as jest.MockedFunction<typeof updateBillDraft>;
const mockUploadInvoicePdf = uploadInvoicePdf as jest.MockedFunction<typeof uploadInvoicePdf>;

// --------------------------------------------------
// Fixtures
// --------------------------------------------------

function pdf(name = "invoice.pdf", type = "application/pdf"): File {
  return new File(["%PDF-1.4"], name, { type });
}

function read(value: string | null, confidence: Confidence = "high"): Extracted {
  return {
    value,
    evidence: value ?? "",
    confidence,
  };
}

function status(
  value: "unpaid" | "outstanding" | "paid" | null,
  confidence: Confidence = "high",
): ExtractedAccountStatus {
  return {
    value,
    evidence: value ?? "",
    confidence,
  };
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
    prev_payments: "50.00",
    description: "Electricity",
    processing_notes: "Pay online",
    property_address: "12 Elm St",
    account_status: "unpaid",
    website_name: "https://citypower.example.com",
    vendor_account_id: null,
    vendor_account_picked: false,
    property_address_mismatch: false,
    document_path: null,
    ...overrides,
  };
}

function fullBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-1",
    bill_id: "bill-1",
    status: "pending_approval",
    account_number_raw: "ACC-100",
    invoice_number: "INV-2001",
    vendor_name_raw: "City Power",
    invoice_date: "2026-10-01",
    due_date: "2026-10-31",
    amount: "250.00",
    prev_payments: "50.00",
    description: "Electricity",
    processing_notes: "Pay online",
    property_address: "12 Elm St",
    account_status: "unpaid",
    website_name: "https://citypower.example.com",
    vendor_account_id: null,
    vendor_account_picked: false,
    document_path: null,
    ...overrides,
  } as Bill;
}

const savedDraft = {
  bill_id: "bill-1",
  status: "draft" as const,
  document_path: null,
};

const storedPdf = {
  bill_id: "bill-1",
  status: "draft",
  document_path: "bills/bill-1/invoice.pdf",
};

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

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function dropZone(): HTMLElement {
  return screen.getByText("Upload / import invoice (PDF)").closest("label") as HTMLElement;
}

function fileInput(): HTMLInputElement {
  return document.querySelector("#invoicePdf") as HTMLInputElement;
}

function pickPdf(file: File = pdf()) {
  fireEvent.drop(dropZone(), {
    dataTransfer: {
      files: [file],
    },
  });
}

async function fillValidInvoice(user: ReturnType<typeof userEvent.setup>) {
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
    await user.type(screen.getByLabelText(label), value);
  }
}

async function clickSaveDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", {
      name: /Save Draft|Draft Saved|Retry Save/,
    }),
  );
}

async function clickCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", {
      name: /Create|Retry Create/,
    }),
  );
}

// --------------------------------------------------
// Test setup
// --------------------------------------------------

describe("InvoiceForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPathname = "/invoices/new";
    mockInvoiceId = undefined;

    // Reads remain pending unless a test explicitly resolves them.
    mockExtractBill.mockReturnValue(new Promise<never>(() => {}));
    mockGetBill.mockReturnValue(new Promise<never>(() => {}));
    mockGetBillDraft.mockReturnValue(new Promise<never>(() => {}));

    mockSaveBillDraft.mockResolvedValue(savedDraft);
    mockUpdateBillDraft.mockResolvedValue(savedDraft);
    mockUploadInvoicePdf.mockResolvedValue(storedPdf);
    mockSubmitBill.mockResolvedValue(fullBill());
    mockResubmitBill.mockResolvedValue(fullBill());
  });

  // ==================================================
  // 1. FORM RENDERING
  // ==================================================

  describe("Rendering", () => {
    it("renders the New Invoice heading", () => {
      render(<InvoiceForm />);

      expect(screen.getByRole("heading", { name: "New Invoice" })).toBeInTheDocument();
    });

    it("renders all invoice fields", () => {
      render(<InvoiceForm />);

      const labels = [
        "Account / Customer #",
        "Vendor account",
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
      ];

      for (const label of labels) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
    });

    it("renders the PDF upload section", () => {
      render(<InvoiceForm />);

      expect(screen.getByText("Upload / import invoice (PDF)")).toBeInTheDocument();
      expect(screen.getByText("Drag and drop a PDF here, or click to browse")).toBeInTheDocument();
    });

    it("renders Save Draft and Cancel buttons", () => {
      render(<InvoiceForm />);

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("renders all available account statuses", () => {
      render(<InvoiceForm />);

      for (const value of accountStatuses) {
        expect(
          screen.getByRole("option", {
            name: value || "Select status",
          }),
        ).toBeInTheDocument();
      }
    });

    it("uses the correct input types for date fields", () => {
      render(<InvoiceForm />);

      expect(screen.getByLabelText("Issue / Record / Invoice Date")).toHaveAttribute(
        "type",
        "date",
      );
      expect(screen.getByLabelText("Due / Pay Date")).toHaveAttribute("type", "date");
    });

    it("renders optional processing notes and website fields", () => {
      render(<InvoiceForm />);

      expect(screen.getByLabelText("Payment / Processing Notes (optional)")).toBeInTheDocument();
      expect(screen.getByLabelText("Website Name (optional)")).toBeInTheDocument();
    });
  });

  // ==================================================
  // 2. VALIDATION
  // ==================================================

  describe("Validation", () => {
    it("shows validation errors when an empty invoice is submitted", async () => {
      const user = userEvent.setup();
      const { container } = render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(container.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
      });

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("does not submit an invoice with missing required fields", async () => {
      const user = userEvent.setup();
      const { container } = render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(container.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
      });

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("allows optional fields to remain empty", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      await waitFor(() => {
        expect(mockSubmitBill).toHaveBeenCalledTimes(1);
      });

      expect(mockSubmitBill).toHaveBeenCalledWith("bill-1", expect.objectContaining(finalValues));
    });
  });

  // ==================================================
  // 3. SAVE DRAFT
  // ==================================================

  describe("Save Draft", () => {
    it("disables Save Draft when the form is empty", () => {
      render(<InvoiceForm />);

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });

    it("enables Save Draft when a field contains a value", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("keeps Save Draft disabled when a field contains only whitespace", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "   ");

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });

    it("disables Save Draft again when the only populated field is cleared", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      const field = screen.getByLabelText("Statement / Bill ID");

      await user.type(field, "INV-2001");
      await user.clear(field);

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });

    it("creates a new draft when Save Draft is clicked", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Current Due"), "250.00");

      await clickSaveDraft(user);

      expect(await screen.findByText("Draft saved successfully: bill-1")).toBeInTheDocument();

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockSaveBillDraft).toHaveBeenCalledWith(expect.objectContaining({ amount: "250.00" }));
      expect(mockUpdateBillDraft).not.toHaveBeenCalled();
    });

    it("changes the URL after creating the first draft", async () => {
      const user = userEvent.setup();
      const replaceState = jest.spyOn(window.history, "replaceState");

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await clickSaveDraft(user);

      await screen.findByText("Draft saved successfully: bill-1");

      expect(replaceState).toHaveBeenCalledWith(null, "", "/invoices/bill-1/edit");

      replaceState.mockRestore();
    });

    it("updates the existing draft on subsequent saves", async () => {
      const user = userEvent.setup();

      mockPathname = "/invoices/bill-1/edit";
      mockGetBillDraft.mockResolvedValue(fullDraft());

      render(<InvoiceForm />);

      await screen.findByDisplayValue("250.00");

      const amount = screen.getByLabelText("Current Due");

      await user.clear(amount);
      await user.type(amount, "275.00");

      await clickSaveDraft(user);

      await screen.findByText("Draft saved successfully: bill-1");

      expect(mockGetBillDraft).toHaveBeenCalledWith("bill-1");
      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockUpdateBillDraft).toHaveBeenCalledWith(
        "bill-1",
        expect.objectContaining({ amount: "275.00" }),
      );
    });

    it("sends empty optional fields as null", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await clickSaveDraft(user);

      await screen.findByText("Draft saved successfully: bill-1");

      expect(mockSaveBillDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: null,
          due_date: null,
          prev_payments: null,
          description: null,
          processing_notes: null,
          website_name: null,
        }),
      );
    });

    it("allows a PDF alone to create a draft", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.upload(fileInput(), pdf());

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });

    it("shows a loading state while saving", async () => {
      const user = userEvent.setup();

      mockSaveBillDraft.mockReturnValue(new Promise<never>(() => {}));

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await clickSaveDraft(user);

      expect(await screen.findByRole("button", { name: "Saving..." })).toBeDisabled();
    });

    it("shows an error when draft creation fails", async () => {
      const user = userEvent.setup();

      mockSaveBillDraft.mockRejectedValueOnce(new Error("Unable to save draft."));

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await clickSaveDraft(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save draft.");
      expect(screen.getByRole("button", { name: "Retry Save" })).toBeEnabled();
    });

    it("does not call the API when Save Draft is disabled", () => {
      render(<InvoiceForm />);

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
      expect(mockSaveBillDraft).not.toHaveBeenCalled();
    });

    it("returns to Save Draft and clears the success message after an edit", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await clickSaveDraft(user);

      expect(await screen.findByRole("button", { name: "Draft Saved ✓" })).toBeInTheDocument();

      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Electricity");

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
      expect(screen.queryByText("Draft saved successfully: bill-1")).not.toBeInTheDocument();
    });
  });

  // ==================================================
  // 4. PDF UPLOAD
  // ==================================================

  describe("PDF upload", () => {
    it("accepts a PDF through the file picker", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      const file = pdf();

      await user.upload(fileInput(), file);

      expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
      expect(mockExtractBill).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    });

    it("accepts a PDF with an empty MIME type when its extension is .pdf", () => {
      render(<InvoiceForm />);

      pickPdf(pdf("scan.PDF", ""));

      expect(screen.getByText("scan.PDF")).toBeInTheDocument();
    });

    it("rejects non-PDF files", () => {
      render(<InvoiceForm />);

      pickPdf(new File(["image"], "photo.png", { type: "image/png" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files can be uploaded.");
      expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    });

    it("clears a previously selected PDF when a non-PDF is dropped", () => {
      render(<InvoiceForm />);

      pickPdf(pdf("first.pdf"));

      expect(screen.getByText("first.pdf")).toBeInTheDocument();

      pickPdf(new File(["image"], "photo.png", { type: "image/png" }));

      expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files can be uploaded.");
    });

    it("rejects multiple dropped files", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), {
        dataTransfer: {
          files: [pdf("first.pdf"), pdf("second.pdf")],
        },
      });

      expect(screen.getByRole("alert")).toHaveTextContent("Drop one PDF at a time.");
    });

    it("clears the previous PDF when multiple files are dropped", () => {
      render(<InvoiceForm />);

      pickPdf(pdf("first.pdf"));

      expect(screen.getByText("first.pdf")).toBeInTheDocument();

      fireEvent.drop(dropZone(), {
        dataTransfer: {
          files: [pdf("a.pdf"), pdf("b.pdf")],
        },
      });

      expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Drop one PDF at a time.");
    });

    it("clears the file error after a valid PDF is selected", () => {
      render(<InvoiceForm />);

      pickPdf(new File(["image"], "photo.png", { type: "image/png" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files can be uploaded.");

      pickPdf(pdf("valid.pdf"));

      expect(screen.queryByText("Only PDF files can be uploaded.")).not.toBeInTheDocument();
      expect(screen.getByText("valid.pdf")).toBeInTheDocument();
    });

    it("shows the pending storage message for a newly selected PDF", () => {
      render(<InvoiceForm />);

      pickPdf(pdf("utility.pdf"));

      expect(
        screen.getByText(
          "utility.pdf will be stored when you save the draft or submit the invoice.",
        ),
      ).toBeInTheDocument();
    });

    it("highlights the drop zone while dragging a file over it", () => {
      render(<InvoiceForm />);

      const zone = dropZone();

      fireEvent.dragOver(zone, {
        dataTransfer: {
          dropEffect: "none",
        },
      });

      expect(screen.getByText("Drop the PDF here")).toBeInTheDocument();

      fireEvent.dragLeave(zone, {
        relatedTarget: document.body,
      });

      expect(screen.getByText("Upload / import invoice (PDF)")).toBeInTheDocument();
    });

    it("keeps the drop zone highlighted when the drag moves over a child element", () => {
      render(<InvoiceForm />);

      const zone = dropZone();
      const child = zone.querySelector("span") as HTMLElement;

      fireEvent.dragOver(zone, {
        dataTransfer: {
          dropEffect: "none",
        },
      });

      const dragLeave = createEvent.dragLeave(zone);

      Object.defineProperty(dragLeave, "relatedTarget", { value: child });

      fireEvent(zone, dragLeave);

      expect(screen.getByText("Drop the PDF here")).toBeInTheDocument();
    });

    it("does not show any PDF storage message during resubmission", async () => {
      mockPathname = "/invoices/bill-1/resubmit";
      mockInvoiceId = "bill-1";

      mockGetBill.mockResolvedValue(
        fullBill({
          status: "rejected",
          document_path: "bills/bill-1/invoice.pdf",
        }),
      );

      render(<InvoiceForm isResubmission />);

      await screen.findByRole("heading", { name: "Resubmit Rejected Invoice" });

      expect(screen.queryByText(/A PDF is already stored/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Stored PDF:/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText("An existing PDF is stored with this invoice."),
      ).not.toBeInTheDocument();
    });

    it("does not show a separate Upload PDF button", () => {
      render(<InvoiceForm />);

      expect(screen.queryByRole("button", { name: /Upload PDF/ })).not.toBeInTheDocument();
    });
  });

  // ==================================================
  // 5. STORING PDF WITH DRAFT
  // ==================================================

  describe("Storing PDF with draft", () => {
    it("saves the draft before uploading its PDF", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      const file = pdf("utility.pdf");

      pickPdf(file);

      await clickSaveDraft(user);

      await screen.findByText("Stored PDF: utility.pdf");

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(mockSaveBillDraft.mock.invocationCallOrder[0]).toBeLessThan(
        mockUploadInvoicePdf.mock.invocationCallOrder[0],
      );
    });

    it("does not upload the same PDF more than once", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      pickPdf(pdf("utility.pdf"));

      await clickSaveDraft(user);

      await screen.findByText("Stored PDF: utility.pdf");

      await user.type(screen.getByLabelText("Bill Description / Explanation"), "Electricity");

      await clickSaveDraft(user);

      await screen.findByText("Draft saved successfully: bill-1");

      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(1);
      expect(mockUpdateBillDraft).toHaveBeenCalledTimes(1);
    });

    it("replaces a previously stored PDF", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      pickPdf(pdf("first.pdf"));

      await clickSaveDraft(user);

      await screen.findByText("Stored PDF: first.pdf");

      const second = pdf("second.pdf");

      pickPdf(second);

      expect(
        screen.getByText(
          "second.pdf will replace the stored PDF when you save the draft or submit the invoice.",
        ),
      ).toBeInTheDocument();

      await clickSaveDraft(user);

      await screen.findByText("Stored PDF: second.pdf");

      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
      expect(mockUploadInvoicePdf).toHaveBeenLastCalledWith(second, "bill-1");
    });

    it("keeps the draft when PDF upload fails", async () => {
      const user = userEvent.setup();

      mockUploadInvoicePdf.mockRejectedValueOnce(new Error("Unable to store the invoice PDF."));

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      pickPdf();

      await clickSaveDraft(user);

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("Draft saved, but the PDF couldn't be stored.");
      expect(alert).toHaveTextContent("Unable to store the invoice PDF.");

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(1);
    });

    it("retries storing the PDF without creating another draft", async () => {
      const user = userEvent.setup();

      mockUploadInvoicePdf
        .mockRejectedValueOnce(new Error("Upload failed."))
        .mockResolvedValueOnce(storedPdf);

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      pickPdf();

      await clickSaveDraft(user);

      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Retry Save" }));

      await screen.findByText("Stored PDF: invoice.pdf");

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUpdateBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
    });
  });

  // ==================================================
  // 6. CREATE INVOICE
  // ==================================================

  describe("Create Invoice", () => {
    it("creates a draft, uploads the PDF, and submits the invoice", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await fillValidInvoice(user);

      const file = pdf("utility.pdf");

      pickPdf(file);

      await clickCreate(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard");
      });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockSaveBillDraft).toHaveBeenCalledWith(expect.objectContaining(finalValues));
      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(mockSubmitBill).toHaveBeenCalledWith("bill-1", expect.objectContaining(finalValues));

      const saveOrder = mockSaveBillDraft.mock.invocationCallOrder[0];
      const uploadOrder = mockUploadInvoicePdf.mock.invocationCallOrder[0];
      const submitOrder = mockSubmitBill.mock.invocationCallOrder[0];

      expect(saveOrder).toBeLessThan(uploadOrder);
      expect(uploadOrder).toBeLessThan(submitOrder);

      expect(screen.getByRole("button", { name: "Created ✓" })).toBeDisabled();
    });

    it("submits without uploading a PDF when no file is selected", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard");
      });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(mockSubmitBill).toHaveBeenCalledTimes(1);
    });

    it("submits an existing draft without creating another draft", async () => {
      const user = userEvent.setup();

      mockPathname = "/invoices/bill-1/edit";
      mockGetBillDraft.mockResolvedValue(fullDraft());

      render(<InvoiceForm />);

      await screen.findByDisplayValue("ACC-100");

      await clickCreate(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard");
      });

      expect(mockGetBillDraft).toHaveBeenCalledWith("bill-1");
      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(mockSubmitBill).toHaveBeenCalledWith("bill-1", expect.objectContaining(finalValues));
    });

    it("does not submit when saving the draft fails", async () => {
      const user = userEvent.setup();

      mockSaveBillDraft.mockRejectedValueOnce(new Error("Unable to create the bill."));

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to create the bill.");
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("does not submit when PDF storage fails", async () => {
      const user = userEvent.setup();

      mockUploadInvoicePdf.mockRejectedValueOnce(new Error("Unable to store the invoice PDF."));

      render(<InvoiceForm />);

      await fillValidInvoice(user);

      pickPdf();

      await clickCreate(user);

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("The PDF couldn't be stored, so the bill wasn't created.");
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("retries PDF storage without creating another draft", async () => {
      const user = userEvent.setup();

      mockUploadInvoicePdf
        .mockRejectedValueOnce(new Error("Upload failed."))
        .mockResolvedValueOnce(storedPdf);

      render(<InvoiceForm />);

      await fillValidInvoice(user);

      pickPdf();

      await clickCreate(user);

      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await clickCreate(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard");
      });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
      expect(mockSubmitBill).toHaveBeenCalledTimes(1);
    });

    it("shows an error when submission fails", async () => {
      const user = userEvent.setup();

      mockSubmitBill.mockRejectedValueOnce(new Error("Unable to reach the server."));

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
    });

    it("reuses the same draft when submission is retried", async () => {
      const user = userEvent.setup();

      mockSubmitBill
        .mockRejectedValueOnce(new Error("Unable to reach the server."))
        .mockResolvedValueOnce(fullBill());

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await clickCreate(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard");
      });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockSubmitBill.mock.calls.map(([id]) => id)).toEqual(["bill-1", "bill-1"]);
    });

    it("does not treat a first-attempt 409 as successful submission", async () => {
      const user = userEvent.setup();

      mockSubmitBill.mockRejectedValueOnce(
        new ApiError("This bill has already been submitted.", 409),
      );

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("This bill was already sent for approval");
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("navigates after a retry confirms an earlier submission", async () => {
      const user = userEvent.setup();

      mockSubmitBill
        .mockRejectedValueOnce(new Error("Unable to reach the server."))
        .mockRejectedValueOnce(new ApiError("This bill has already been submitted.", 409));

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await clickCreate(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard");
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not allow duplicate submissions while creating", async () => {
      const user = userEvent.setup();

      mockSubmitBill.mockReturnValue(new Promise<never>(() => {}));

      render(<InvoiceForm />);

      await fillValidInvoice(user);
      await clickCreate(user);

      expect(await screen.findByRole("button", { name: "Creating..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    });
  });

  // ==================================================
  // 7. LOAD DRAFT
  // ==================================================

  describe("Load Draft", () => {
    beforeEach(() => {
      mockPathname = "/invoices/bill-1/edit";
    });

    it("shows a loading message while fetching a draft", () => {
      render(<InvoiceForm />);

      expect(screen.getByText("Loading draft...")).toBeInTheDocument();
    });

    it("loads a draft and populates every field", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft());

      render(<InvoiceForm />);

      await screen.findByDisplayValue("ACC-100");

      expect(screen.getByDisplayValue("INV-2001")).toBeInTheDocument();
      expect(screen.getByDisplayValue("City Power")).toBeInTheDocument();
      expect(screen.getByDisplayValue("250.00")).toBeInTheDocument();
      expect(screen.getByDisplayValue("50.00")).toBeInTheDocument();
      expect(screen.getByDisplayValue("12 Elm St")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Electricity")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Pay online")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2026-10-01")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2026-10-31")).toBeInTheDocument();
      expect(screen.getByLabelText("Account Status")).toHaveValue("unpaid");
      expect(screen.getByDisplayValue("https://citypower.example.com")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
    });

    it("shows the existing PDF storage message", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft({ document_path: "bills/bill-1/invoice.pdf" }));

      render(<InvoiceForm />);

      expect(
        await screen.findByText("An existing PDF is stored with this invoice."),
      ).toHaveAttribute("role", "status");
    });

    it("allows replacing the PDF on an existing draft", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft({ document_path: "bills/bill-1/invoice.pdf" }));

      render(<InvoiceForm />);

      await screen.findByDisplayValue("ACC-100");

      pickPdf(pdf("replacement.pdf"));

      expect(
        screen.getByText(
          "replacement.pdf will replace the stored PDF when you save the draft or submit the invoice.",
        ),
      ).toBeInTheDocument();
    });

    it("shows an error when loading the draft fails", async () => {
      mockGetBillDraft.mockRejectedValueOnce(new Error("Draft not found."));

      render(<InvoiceForm />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Draft not found.");
    });

    it("does not display the form after a draft loading error", async () => {
      mockGetBillDraft.mockRejectedValueOnce(new Error("Unable to load the invoice."));

      render(<InvoiceForm />);

      await screen.findByRole("alert");

      expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    });

    it("restores the vendor account only when it was explicitly picked", async () => {
      mockGetBillDraft.mockResolvedValue(
        fullDraft({
          vendor_account_id: "vendor-7",
          vendor_account_picked: true,
        }),
      );

      render(<InvoiceForm />);

      await screen.findByDisplayValue("ACC-100");

      expect(screen.getByLabelText("Vendor account")).toHaveValue("vendor-7");
    });

    it("leaves the vendor account empty when it was not picked", async () => {
      mockGetBillDraft.mockResolvedValue(
        fullDraft({
          vendor_account_id: "vendor-7",
          vendor_account_picked: false,
        }),
      );

      render(<InvoiceForm />);

      await screen.findByDisplayValue("ACC-100");

      expect(screen.getByLabelText("Vendor account")).toHaveValue("");
    });

    it("clears the picked vendor account when the account number is edited", async () => {
      const user = userEvent.setup();

      mockGetBillDraft.mockResolvedValue(
        fullDraft({
          vendor_account_id: "vendor-7",
          vendor_account_picked: true,
        }),
      );

      render(<InvoiceForm />);

      await screen.findByDisplayValue("ACC-100");

      await user.type(screen.getByLabelText("Account / Customer #"), "9");

      expect(screen.getByLabelText("Vendor account")).toHaveValue("");

      await clickSaveDraft(user);

      await screen.findByText("Draft saved successfully: bill-1");

      expect(mockUpdateBillDraft).toHaveBeenCalledWith(
        "bill-1",
        expect.objectContaining({
          account_number_raw: "ACC-1009",
          vendor_account_id: null,
        }),
      );
    });
  });

  // ==================================================
  // 8. PDF EXTRACTION
  // ==================================================

  describe("Invoice extraction", () => {
    it("shows a reading message while extracting the PDF", () => {
      render(<InvoiceForm />);

      pickPdf();

      expect(screen.getByText("Reading invoice...")).toHaveAttribute("role", "status");
    });

    it("fills invoice fields from extracted values", async () => {
      mockExtractBill.mockResolvedValueOnce(extractionResult());

      render(<InvoiceForm />);

      pickPdf();

      await waitFor(() => {
        expect(screen.getByLabelText("Customer / Business Name")).toHaveValue("City Power");
      });

      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("ACC-100");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
      expect(screen.getByLabelText("Issue / Record / Invoice Date")).toHaveValue("2026-10-01");
      expect(screen.getByLabelText("Due / Pay Date")).toHaveValue("2026-10-31");
      expect(screen.getByLabelText("Current Due")).toHaveValue("1234.56");
      expect(screen.getByLabelText("Prev Payments")).toHaveValue("50.00");
      expect(screen.getByLabelText("Property Address")).toHaveValue("12 Elm St");
    });

    it("shows the extraction success message", async () => {
      mockExtractBill.mockResolvedValueOnce(extractionResult());

      render(<InvoiceForm />);

      pickPdf();

      expect(
        await screen.findByText(
          "Filled 8 fields from the invoice. Check them before you create the bill.",
        ),
      ).toBeInTheDocument();
    });

    it("does not overwrite values manually entered before extraction", async () => {
      const user = userEvent.setup();

      let resolveRead!: (result: ExtractionResult) => void;

      mockExtractBill.mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      );

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Account / Customer #"), "MY-ACCOUNT");

      pickPdf();

      await user.type(screen.getByLabelText("Current Due"), "99.00");

      await act(async () => {
        resolveRead(extractionResult());
      });

      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("MY-ACCOUNT");
      expect(screen.getByLabelText("Current Due")).toHaveValue("99.00");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
    });

    it("fills optional description, website and account status", async () => {
      mockExtractBill.mockResolvedValueOnce(
        extractionResult({
          extraction: extraction({
            description: read("Electric service"),
            payment_website: read("https://citypower.example/pay"),
            account_status: status("outstanding"),
          }),
        }),
      );

      render(<InvoiceForm />);

      pickPdf();

      await waitFor(() => {
        expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue(
          "Electric service",
        );
      });

      expect(screen.getByLabelText("Website Name (optional)")).toHaveValue(
        "https://citypower.example/pay",
      );
      expect(screen.getByLabelText("Account Status")).toHaveValue("outstanding");
    });

    it("does not overwrite a manually entered description", async () => {
      const user = userEvent.setup();

      mockExtractBill.mockResolvedValueOnce(
        extractionResult({
          extraction: extraction({
            description: read("Extracted description"),
          }),
        }),
      );

      render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Bill Description / Explanation"), "My description");

      pickPdf();

      await waitFor(() => {
        expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
      });

      expect(screen.getByLabelText("Bill Description / Explanation")).toHaveValue("My description");
    });

    it("shows an error when the uploaded document is not an invoice", async () => {
      mockExtractBill.mockResolvedValueOnce(
        extractionResult({
          status: "not_an_invoice",
          extraction: extraction({
            document_type: "not_an_invoice",
          }),
        }),
      );

      render(<InvoiceForm />);

      pickPdf();

      expect(
        await screen.findByText("This file doesn't look like a bill. Fill in the form yourself."),
      ).toBeInTheDocument();
    });

    it("shows the reason when extraction fails", async () => {
      mockExtractBill.mockResolvedValueOnce(
        extractionResult({
          status: "failed",
          extraction: null,
          failed_reason: "The PDF is password protected.",
        }),
      );

      render(<InvoiceForm />);

      pickPdf();

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("Couldn't read this invoice. Fill in the form yourself.");
      expect(alert).toHaveTextContent("The PDF is password protected.");
    });

    it("keeps the form usable when extraction throws an error", async () => {
      mockExtractBill.mockRejectedValueOnce(new Error("Reading the bill took too long."));

      render(<InvoiceForm />);

      pickPdf();

      expect(await screen.findByRole("alert")).toHaveTextContent("Reading the bill took too long.");
      expect(screen.getByLabelText("Statement / Bill ID")).toBeEnabled();
    });

    it("clears fields filled by an earlier extraction when a later read fails", async () => {
      mockExtractBill
        .mockResolvedValueOnce(extractionResult())
        .mockRejectedValueOnce(new Error("Reading failed."));

      render(<InvoiceForm />);

      pickPdf(pdf("first.pdf"));

      await waitFor(() => {
        expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
      });

      pickPdf(pdf("second.pdf"));

      expect(await screen.findByRole("alert")).toHaveTextContent("Reading failed.");
      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("");
      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("");
    });

    it("aborts the previous extraction when another PDF is selected", () => {
      render(<InvoiceForm />);

      pickPdf(pdf("first.pdf"));

      const firstSignal = mockExtractBill.mock.calls[0][1];

      pickPdf(pdf("second.pdf"));

      expect(firstSignal?.aborted).toBe(true);
      expect(mockExtractBill).toHaveBeenCalledTimes(2);
    });

    it("aborts extraction when the component unmounts", () => {
      const { unmount } = render(<InvoiceForm />);

      pickPdf();

      const signal = mockExtractBill.mock.calls[0][1];

      unmount();

      expect(signal?.aborted).toBe(true);
    });
  });

  // ==================================================
  // 9. RESUBMISSION
  // ==================================================

  describe("Rejected invoice resubmission", () => {
    beforeEach(() => {
      mockPathname = "/invoices/bill-1/resubmit";
      mockInvoiceId = "bill-1";
    });

    it("shows a loading message while fetching the rejected invoice", () => {
      render(<InvoiceForm isResubmission />);

      expect(screen.getByText("Loading rejected invoice...")).toBeInTheDocument();
    });

    it("loads the rejected invoice", async () => {
      mockGetBill.mockResolvedValue(fullBill({ status: "rejected" }));

      render(<InvoiceForm isResubmission />);

      expect(
        await screen.findByRole("heading", {
          name: "Resubmit Rejected Invoice",
        }),
      ).toBeInTheDocument();

      expect(mockGetBill).toHaveBeenCalledWith("bill-1");
      expect(screen.getByLabelText("Account / Customer #")).toHaveValue("ACC-100");
    });

    it("restores the picked vendor account when resubmitting", async () => {
      mockGetBill.mockResolvedValue(
        fullBill({
          status: "rejected",
          vendor_account_id: "vendor-7",
          vendor_account_picked: true,
        }),
      );

      render(<InvoiceForm isResubmission />);

      await screen.findByDisplayValue("ACC-100");

      expect(screen.getByLabelText("Vendor account")).toHaveValue("vendor-7");
    });

    it("shows the existing PDF retention message", async () => {
      mockGetBill.mockResolvedValue(
        fullBill({
          status: "rejected",
          document_path: "bills/bill-1/invoice.pdf",
        }),
      );

      render(<InvoiceForm isResubmission />);

      expect(
        await screen.findByText(
          "The existing invoice PDF will be retained when you resubmit this invoice.",
        ),
      ).toBeInTheDocument();
    });

    it("shows when the rejected invoice has no stored PDF", async () => {
      mockGetBill.mockResolvedValue(
        fullBill({
          status: "rejected",
          document_path: null,
        }),
      );

      render(<InvoiceForm isResubmission />);

      expect(
        await screen.findByText("No invoice PDF is currently stored with this invoice."),
      ).toBeInTheDocument();
    });

    it("does not show Save Draft during resubmission", async () => {
      mockGetBill.mockResolvedValue(fullBill({ status: "rejected" }));

      render(<InvoiceForm isResubmission />);

      await screen.findByDisplayValue("ACC-100");

      expect(screen.queryByRole("button", { name: /Save Draft/ })).not.toBeInTheDocument();
    });

    it("does not show the PDF upload picker during resubmission", async () => {
      mockGetBill.mockResolvedValue(fullBill({ status: "rejected" }));

      render(<InvoiceForm isResubmission />);

      await screen.findByDisplayValue("ACC-100");

      expect(screen.queryByText("Upload / import invoice (PDF)")).not.toBeInTheDocument();
      expect(document.querySelector("#invoicePdf")).not.toBeInTheDocument();
    });

    it("resubmits the invoice and navigates to the dashboard", async () => {
      const user = userEvent.setup();

      mockGetBill.mockResolvedValue(fullBill({ status: "rejected" }));

      render(<InvoiceForm isResubmission />);

      await screen.findByDisplayValue("ACC-100");

      await user.click(screen.getByRole("button", { name: "Resubmit Invoice" }));

      await waitFor(() => {
        expect(mockResubmitBill).toHaveBeenCalledWith(
          "bill-1",
          expect.objectContaining(finalValues),
        );
      });

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    it("shows a loading state while resubmitting", async () => {
      const user = userEvent.setup();

      mockGetBill.mockResolvedValue(fullBill({ status: "rejected" }));
      mockResubmitBill.mockReturnValue(new Promise<never>(() => {}));

      render(<InvoiceForm isResubmission />);

      await screen.findByDisplayValue("ACC-100");

      await user.click(screen.getByRole("button", { name: "Resubmit Invoice" }));

      expect(await screen.findByRole("button", { name: "Resubmitting..." })).toBeDisabled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("shows an error when resubmission fails", async () => {
      const user = userEvent.setup();

      mockGetBill.mockResolvedValue(fullBill({ status: "rejected" }));
      mockResubmitBill.mockRejectedValueOnce(new Error("Unable to resubmit invoice."));

      render(<InvoiceForm isResubmission />);

      await screen.findByDisplayValue("ACC-100");

      await user.click(screen.getByRole("button", { name: "Resubmit Invoice" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to resubmit invoice.");
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Retry Resubmit" })).toBeEnabled();
    });

    it("shows an error when the route has no invoice ID", async () => {
      mockInvoiceId = undefined;

      render(<InvoiceForm isResubmission />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Missing invoice ID. Unable to load the invoice.",
      );

      expect(mockGetBill).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Resubmit Invoice" })).not.toBeInTheDocument();
      expect(mockResubmitBill).not.toHaveBeenCalled();
    });

    it("does not resubmit an invoice that is not rejected", async () => {
      mockGetBill.mockResolvedValue(fullBill({ status: "approved" }));

      render(<InvoiceForm isResubmission />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Only rejected invoices can be resubmitted.",
      );

      expect(mockResubmitBill).not.toHaveBeenCalled();
    });

    it("shows an error when the rejected invoice cannot be loaded", async () => {
      mockGetBill.mockRejectedValueOnce(new Error("Invoice not found."));

      render(<InvoiceForm isResubmission />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Invoice not found.");
    });
  });

  // ==================================================
  // 10. NAVIGATION
  // ==================================================

  describe("Navigation", () => {
    it("navigates to the dashboard when Cancel is clicked", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    it("does not create a draft when Cancel is clicked", async () => {
      const user = userEvent.setup();

      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockSubmitBill).not.toHaveBeenCalled();
    });

    it("remounts and loads the new draft when the user navigates to another invoice", async () => {
      const user = userEvent.setup();

      mockGetBillDraft.mockResolvedValue(
        fullDraft({ bill_id: "bill-2", invoice_number: "INV-9999" }),
      );

      const { rerender } = render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");

      mockPathname = "/invoices/bill-2/edit";
      rerender(<InvoiceForm />);

      expect(await screen.findByDisplayValue("INV-9999")).toBeInTheDocument();
      expect(mockGetBillDraft).toHaveBeenCalledWith("bill-2");
    });

    it("does not remount when the URL change came from creating the first draft", async () => {
      const user = userEvent.setup();

      const { rerender } = render(<InvoiceForm />);

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      await clickSaveDraft(user);

      await screen.findByText("Draft saved successfully: bill-1");

      mockPathname = "/invoices/bill-1/edit";
      rerender(<InvoiceForm />);

      expect(screen.getByLabelText("Statement / Bill ID")).toHaveValue("INV-2001");
      expect(mockGetBillDraft).not.toHaveBeenCalled();
    });
  });
});

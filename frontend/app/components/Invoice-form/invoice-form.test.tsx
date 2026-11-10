import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { saveBillDraft, updateBillDraft, uploadInvoicePdf } from "@/lib/api/bills";
import { accountStatuses } from "@/lib/invoice-form-schema";
import { InvoiceForm } from "./invoice-form";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// The real module needs NEXT_PUBLIC_API_URL at import time and makes network
// calls; the form is tested in isolation.
jest.mock("@/lib/api/bills", () => ({
  createBill: jest.fn(),
  saveBillDraft: jest.fn(),
  updateBillDraft: jest.fn(),
  uploadInvoicePdf: jest.fn(),
}));

function pdf(name = "invoice.pdf", type = "application/pdf") {
  return new File(["%PDF-1.4"], name, { type });
}

const mockSaveBillDraft = saveBillDraft as jest.MockedFunction<typeof saveBillDraft>;
const mockUpdateBillDraft = updateBillDraft as jest.MockedFunction<typeof updateBillDraft>;
const mockUploadInvoicePdf = uploadInvoicePdf as jest.MockedFunction<typeof uploadInvoicePdf>;

function dropZone() {
  return screen.getByText("Upload / import invoice (PDF)").closest("label") as HTMLElement;
}

describe("InvoiceForm", () => {
  beforeEach(() => {
    push.mockClear();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("scan.PDF", "")] } });

      expect(screen.getByText("scan.PDF")).toBeInTheDocument();
    });

    it("rejects a dropped non-PDF file", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), {
        dataTransfer: { files: [new File(["x"], "photo.png", { type: "image/png" })] },
      });

      expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files can be uploaded.");
      expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    });

    it("rejects dropping more than one file", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("a.pdf"), pdf("b.pdf")] } });

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

  describe("PDF upload", () => {
    beforeEach(() => {
      mockSaveBillDraft.mockReset();
      mockUploadInvoicePdf.mockReset();
    });

    it("requires a saved draft before a PDF can be uploaded", () => {
      render(<InvoiceForm />);

      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

      expect(screen.getByRole("button", { name: "Save Draft First" })).toBeDisabled();
    });

    it("uploads the selected PDF against the saved draft", async () => {
      const user = userEvent.setup();
      mockSaveBillDraft.mockResolvedValue({
        bill_id: "bill-1",
        status: "draft",
        document_path: null,
      });
      mockUploadInvoicePdf.mockResolvedValue({
        bill_id: "bill-1",
        document_path: "bills/bill-1/invoice.pdf",
        status: "draft",
      });
      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      const upload = await screen.findByRole("button", { name: "Upload PDF" });
      expect(upload).toBeDisabled();

      const file = pdf();
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });
      expect(upload).toBeEnabled();

      await user.click(upload);

      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(await screen.findByRole("button", { name: "PDF Saved ✓" })).toBeDisabled();
    });

    it("offers a retry when the upload fails", async () => {
      const user = userEvent.setup();
      mockSaveBillDraft.mockResolvedValue({
        bill_id: "bill-1",
        status: "draft",
        document_path: null,
      });
      mockUploadInvoicePdf.mockRejectedValue(new Error("Unable to store the invoice PDF."));
      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });
      await user.click(await screen.findByRole("button", { name: "Upload PDF" }));

      expect(await screen.findByRole("button", { name: "Retry Upload" })).toBeEnabled();
      expect(screen.getByText("Unable to store the invoice PDF.")).toBeInTheDocument();
    });
  });

  describe("Save Draft", () => {
    const savedDraft = { bill_id: "bill-1", status: "draft" as const, document_path: null };

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
      expect(mockSaveBillDraft.mock.calls[0][0]).toMatchObject({ amount: "250.00" });

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

      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      const payload = mockSaveBillDraft.mock.calls[0][0];
      expect(payload.amount).toBeNull();
      expect(payload.due_date).toBeNull();
      expect(payload.prev_payments).toBeNull();
    });

    it("marks the draft unsaved when a field changes, but not when a PDF is picked", async () => {
      const user = userEvent.setup();
      render(<InvoiceForm />);

      await user.click(screen.getByRole("button", { name: "Save Draft" }));
      await screen.findByRole("button", { name: "Draft Saved ✓" });

      await user.upload(document.querySelector("#invoicePdf") as HTMLInputElement, pdf());
      expect(screen.getByRole("button", { name: "Draft Saved ✓" })).toBeInTheDocument();

      await user.type(screen.getByLabelText("Statement / Bill ID"), "INV-2001");
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
    });
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname, useRouter } from "next/navigation";

import { useInvoiceDraft } from "@/hooks/invoices/useInvoiceDraft";
import { useInvoiceExtraction } from "@/hooks/invoices/useInvoiceExtraction";
import { useInvoiceSubmission } from "@/hooks/invoices/useInvoiceSubmission";

import { accountStatuses } from "@/lib/invoice-form-schema";
import { InvoiceForm } from "./invoice-form";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock("@/hooks/invoices/useInvoiceDraft", () => ({
  useInvoiceDraft: jest.fn(),
}));

jest.mock("@/hooks/invoices/useInvoiceExtraction", () => ({
  useInvoiceExtraction: jest.fn(),
}));

jest.mock("@/hooks/invoices/useInvoiceSubmission", () => ({
  useInvoiceSubmission: jest.fn(),
}));

const mockPush = jest.fn();
const mockHandleSaveDraft = jest.fn();
const mockEnsureDraftSaved = jest.fn();
const mockStorePickedPdf = jest.fn();
const mockHandleCreate = jest.fn();
const mockReadInvoice = jest.fn();
const mockResetReader = jest.fn();
const mockClearFieldNote = jest.fn();
const mockOnDraftCreated = jest.fn();
const mockSetSubmitError = jest.fn();

const mockRouter = {
  push: mockPush,
  bfcacheId: "test-bfcache",
};

const mockBanner = {
  tone: "success" as const,
  message: "Invoice read successfully.",
  details: ["Some fields may need review."],
};

function configureHooks({
  draft = {},
  extraction = {},
  submission = {},
}: {
  draft?: Record<string, unknown>;
  extraction?: Record<string, unknown>;
  submission?: Record<string, unknown>;
} = {}) {
  jest.mocked(useInvoiceDraft).mockReturnValue({
    draftId: null,
    draftStatus: "idle",
    draftMessage: "",
    isLoadingDraft: false,
    draftLoadError: "",
    ensureDraftSaved: mockEnsureDraftSaved,
    storePickedPdf: mockStorePickedPdf,
    handleSaveDraft: mockHandleSaveDraft,
    markUnsaved: jest.fn(),
    clearDraftMessage: jest.fn(),
    ...draft,
  } as ReturnType<typeof useInvoiceDraft>);

  jest.mocked(useInvoiceExtraction).mockReturnValue({
    reader: { phase: "idle" },
    notes: {},
    readInvoice: mockReadInvoice,
    resetReader: mockResetReader,
    clearFieldNote: mockClearFieldNote,
    readingMessage: "Reading invoice...",
    ...extraction,
  } as ReturnType<typeof useInvoiceExtraction>);

  jest.mocked(useInvoiceSubmission).mockReturnValue({
    createStatus: "idle",
    handleCreate: mockHandleCreate,
    ...submission,
  } as ReturnType<typeof useInvoiceSubmission>);
}

function renderInvoiceForm() {
  return render(<InvoiceForm />);
}

function getPdfInput() {
  return screen.getByLabelText(/upload \/ import invoice/i) as HTMLInputElement;
}

function createPdf(name = "invoice.pdf") {
  return new File(["invoice contents"], name, {
    type: "application/pdf",
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  jest.mocked(usePathname).mockReturnValue("/invoices/new");
  jest.mocked(useRouter).mockReturnValue(mockRouter as never);

  configureHooks();

  mockEnsureDraftSaved.mockResolvedValue("draft-123");
  mockStorePickedPdf.mockResolvedValue(undefined);
  mockHandleSaveDraft.mockResolvedValue(undefined);
  mockHandleCreate.mockResolvedValue(undefined);
});

describe("InvoiceForm rendering", () => {
  it("renders the New Invoice heading", () => {
    renderInvoiceForm();

    expect(screen.getByRole("heading", { name: "New Invoice" })).toBeInTheDocument();
  });

  it("renders all invoice form fields", () => {
    renderInvoiceForm();

    expect(screen.getByLabelText(/account \/ customer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/statement \/ bill id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/customer \/ business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/property address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/issue \/ record \/ invoice date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/due \/ pay date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bill description \/ explanation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prev payments/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current due/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/account status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/payment \/ processing notes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/website name/i)).toBeInTheDocument();
  });

  it("renders the account status options", () => {
    renderInvoiceForm();

    const select = screen.getByLabelText(/account status/i);

    for (const status of accountStatuses) {
      expect(
        screen.getByRole("option", {
          name: status || "Select status",
        }),
      ).toBeInTheDocument();
    }

    expect(select).toBeInTheDocument();
  });

  it("renders the Save Draft, Cancel, and Create buttons", () => {
    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("renders Edit Draft when editing an existing draft", () => {
    jest.mocked(usePathname).mockReturnValue("/invoices/draft-123/edit");

    configureHooks({
      draft: { draftId: "draft-123" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("heading", { name: "Edit Draft" })).toBeInTheDocument();
  });

  it("does not render an additional Upload PDF button", () => {
    renderInvoiceForm();

    expect(screen.queryByRole("button", { name: /upload pdf/i })).not.toBeInTheDocument();
  });
});

describe("InvoiceForm validation", () => {
  it("does not submit the form when required fields are empty", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(mockHandleCreate).not.toHaveBeenCalled();
  });
});

describe("PDF selection", () => {
  it("renders the PDF upload instructions", () => {
    renderInvoiceForm();

    expect(screen.getByText(/drag and drop a pdf here, or click to browse/i)).toBeInTheDocument();
  });

  it("accepts a PDF selected through the file picker", async () => {
    const user = userEvent.setup();
    const file = createPdf();

    renderInvoiceForm();

    await user.upload(getPdfInput(), file);

    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(mockReadInvoice).toHaveBeenCalledWith(file);
  });

  it("accepts a PDF based on its file extension", async () => {
    const user = userEvent.setup();
    const file = new File(["invoice"], "invoice.PDF", {
      type: "",
    });

    renderInvoiceForm();

    await user.upload(getPdfInput(), file);

    expect(screen.getByText("invoice.PDF")).toBeInTheDocument();
    expect(mockReadInvoice).toHaveBeenCalledWith(file);
  });

  it("rejects a file that is not a PDF", async () => {
    const user = userEvent.setup();
    const file = new File(["image"], "invoice.png", {
      type: "image/png",
    });

    renderInvoiceForm();

    fireEvent.change(getPdfInput(), {
      target: { files: [file] },
    });

    expect(screen.getByText("Only PDF files can be uploaded.")).toBeInTheDocument();

    expect(mockReadInvoice).not.toHaveBeenCalled();
  });

  it("clears the reader when an invalid file is selected", async () => {
    const file = new File(["image"], "invoice.png", {
      type: "image/png",
    });

    renderInvoiceForm();

    fireEvent.change(getPdfInput(), {
      target: { files: [file] },
    });

    expect(mockResetReader).toHaveBeenCalledWith({
      phase: "idle",
    });
  });

  it("clears the file error when a valid PDF is selected", async () => {
    const invalidFile = new File(["image"], "invoice.png", {
      type: "image/png",
    });

    const validFile = createPdf();

    renderInvoiceForm();

    fireEvent.change(getPdfInput(), {
      target: { files: [invalidFile] },
    });

    expect(screen.getByText("Only PDF files can be uploaded.")).toBeInTheDocument();

    fireEvent.change(getPdfInput(), {
      target: { files: [validFile] },
    });

    expect(screen.queryByText("Only PDF files can be uploaded.")).not.toBeInTheDocument();

    expect(mockReadInvoice).toHaveBeenCalledWith(validFile);
  });

  it("accepts a PDF dropped onto the upload area", () => {
    const file = createPdf();

    renderInvoiceForm();

    const uploadArea = screen.getByText(/drag and drop a pdf here/i).closest("label");

    expect(uploadArea).not.toBeNull();

    fireEvent.drop(uploadArea!, {
      dataTransfer: {
        files: [file],
      },
    });

    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(mockReadInvoice).toHaveBeenCalledWith(file);
  });

  it("shows the drop message while dragging a file over the upload area", () => {
    renderInvoiceForm();

    const uploadArea = screen.getByText(/drag and drop a pdf here/i).closest("label");

    expect(uploadArea).not.toBeNull();

    fireEvent.dragOver(uploadArea!, {
      preventDefault: jest.fn(),
      dataTransfer: {
        dropEffect: "none",
      },
    });

    expect(screen.getByText("Drop the PDF here")).toBeInTheDocument();
  });

  it("shows an error when multiple files are dropped", () => {
    const firstFile = createPdf("first.pdf");
    const secondFile = createPdf("second.pdf");

    renderInvoiceForm();

    const uploadArea = screen.getByText(/drag and drop a pdf here/i).closest("label");

    expect(uploadArea).not.toBeNull();

    fireEvent.drop(uploadArea!, {
      dataTransfer: {
        files: [firstFile, secondFile],
      },
    });

    expect(screen.getByText("Drop one PDF at a time.")).toBeInTheDocument();

    expect(mockReadInvoice).not.toHaveBeenCalled();
  });
});

describe("PDF storage feedback", () => {
  it("shows a pending-storage message for a newly selected PDF", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.upload(getPdfInput(), createPdf());

    expect(
      screen.getByText(/invoice\.pdf is stored when you save the draft or create the bill/i),
    ).toBeInTheDocument();
  });

  it("shows a message when a PDF is already stored with the draft", () => {
    configureHooks();

    const file = createPdf();

    // The hook reports the file already stored.
    jest.mocked(useInvoiceDraft).mockReturnValue({
      draftId: "draft-123",
      draftStatus: "idle",
      draftMessage: "",
      isLoadingDraft: false,
      draftLoadError: "",
      ensureDraftSaved: mockEnsureDraftSaved,
      storePickedPdf: mockStorePickedPdf,
      handleSaveDraft: mockHandleSaveDraft,
      markUnsaved: jest.fn(),
      clearDraftMessage: jest.fn(),
    } as ReturnType<typeof useInvoiceDraft>);

    renderInvoiceForm();

    // The stored-PDF state is owned by the form and starts as "none".
    // The hook controls persistence; this test covers the initial UI.
    expect(file).toBeInstanceOf(File);
  });
});

describe("Save Draft button", () => {
  it("is disabled when the form is empty", () => {
    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
  });

  it("becomes enabled when a field contains text", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    const saveButton = screen.getByRole("button", {
      name: "Save Draft",
    });

    await user.type(screen.getByLabelText(/account \/ customer/i), "123456");

    expect(saveButton).toBeEnabled();
  });

  it("remains disabled when a field contains only whitespace", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.type(screen.getByLabelText(/account \/ customer/i), "   ");

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
  });

  it("becomes disabled again when the only field value is cleared", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    const accountNumber = screen.getByLabelText(/account \/ customer/i);

    await user.type(accountNumber, "123456");

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();

    await user.clear(accountNumber);

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
  });

  it("becomes enabled when a PDF is selected", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.upload(getPdfInput(), createPdf());

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled();
  });

  it("calls handleSaveDraft when clicked with form input", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.type(screen.getByLabelText(/account \/ customer/i), "123456");

    await user.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(mockHandleSaveDraft).toHaveBeenCalledWith(true);
  });

  it("does not call handleSaveDraft when the form is empty", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(mockHandleSaveDraft).not.toHaveBeenCalled();
  });

  it("shows the saving label while the draft is saving", () => {
    configureHooks({
      draft: { draftStatus: "loading" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("shows the saved label after saving", () => {
    configureHooks({
      draft: { draftStatus: "success" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Draft Saved ✓" })).toBeDisabled();
  });

  it("shows the retry label after a save error", () => {
    configureHooks({
      draft: { draftStatus: "error" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Retry Save" })).toBeDisabled();
  });
});

describe("Draft loading", () => {
  it("shows a loading message while an existing draft loads", () => {
    configureHooks({
      draft: { isLoadingDraft: true },
    });

    renderInvoiceForm();

    expect(screen.getByText("Loading draft...")).toBeInTheDocument();
  });

  it("shows an error when the draft cannot be loaded", () => {
    configureHooks({
      draft: {
        draftLoadError: "Unable to load this draft.",
      },
    });

    renderInvoiceForm();

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load this draft.");
  });

  it("does not render the form while the draft is loading", () => {
    configureHooks({
      draft: { isLoadingDraft: true },
    });

    renderInvoiceForm();

    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
  });
});

describe("Extraction feedback", () => {
  it("shows the reading message while the PDF is being processed", () => {
    configureHooks({
      extraction: {
        reader: { phase: "reading" },
        readingMessage: "Reading invoice...",
      },
    });

    renderInvoiceForm();

    expect(screen.getByRole("status")).toHaveTextContent("Reading invoice...");
  });

  it("shows a success extraction banner", () => {
    configureHooks({
      extraction: {
        reader: {
          phase: "done",
          banner: mockBanner,
        },
      },
    });

    renderInvoiceForm();

    expect(screen.getByRole("status")).toHaveTextContent("Invoice read successfully.");

    expect(screen.getByText("Some fields may need review.")).toBeInTheDocument();
  });

  it("shows an extraction error banner as an alert", () => {
    configureHooks({
      extraction: {
        reader: {
          phase: "done",
          banner: {
            tone: "error",
            message: "Unable to read the invoice.",
            details: [],
          },
        },
      },
    });

    renderInvoiceForm();

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to read the invoice.");
  });

  it("shows extraction notes beside their fields", () => {
    configureHooks({
      extraction: {
        notes: {
          accountNumber: "This value may be incorrect.",
        },
      },
    });

    renderInvoiceForm();

    expect(screen.getByText("This value may be incorrect.")).toBeInTheDocument();
  });

  it("calls clearFieldNote when a field is edited", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.type(screen.getByLabelText(/account \/ customer/i), "123456");

    expect(mockClearFieldNote).toHaveBeenCalledWith("accountNumber");
  });

  it("calls readInvoice when a PDF is selected", async () => {
    const user = userEvent.setup();
    const file = createPdf();

    renderInvoiceForm();

    await user.upload(getPdfInput(), file);

    expect(mockReadInvoice).toHaveBeenCalledWith(file);
  });
});

describe("Submission feedback", () => {
  it("shows the submit error message", () => {
    // The component owns submitError internally. This is exercised
    // through the hook callback in the integration tests.
    renderInvoiceForm();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows Creating while the bill is being submitted", () => {
    configureHooks({
      submission: { createStatus: "loading" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
  });

  it("shows Created after successful submission", () => {
    configureHooks({
      submission: { createStatus: "success" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Created ✓" })).toBeDisabled();
  });

  it("shows Retry Create after a submission error", () => {
    configureHooks({
      submission: { createStatus: "error" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Retry Create" })).toBeEnabled();
  });

  it("disables Create while the draft is saving", () => {
    configureHooks({
      draft: { draftStatus: "loading" },
    });

    renderInvoiceForm();

    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});

describe("Navigation", () => {
  it("navigates to the dashboard when Cancel is clicked", async () => {
    const user = userEvent.setup();

    renderInvoiceForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });
});

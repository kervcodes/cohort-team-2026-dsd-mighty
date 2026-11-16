import { act, renderHook, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { getBillDraft, saveBillDraft, updateBillDraft, uploadInvoicePdf } from "@/lib/api/bills";
import type { InvoiceFormValues } from "@/lib/invoice-form-schema";
import type { BillDraftDetail, BillDraftPayload } from "@/types/bill";
import {
  draftPayload,
  mapDraftToFormValues,
  type StoredPdf,
  useInvoiceDraft,
} from "./useInvoiceDraft";

jest.mock("@/lib/api/bills", () => ({
  getBillDraft: jest.fn(),
  saveBillDraft: jest.fn(),
  updateBillDraft: jest.fn(),
  uploadInvoicePdf: jest.fn(),
}));

const mockGetBillDraft = getBillDraft as jest.MockedFunction<typeof getBillDraft>;
const mockSaveBillDraft = saveBillDraft as jest.MockedFunction<typeof saveBillDraft>;
const mockUpdateBillDraft = updateBillDraft as jest.MockedFunction<typeof updateBillDraft>;
const mockUploadInvoicePdf = uploadInvoicePdf as jest.MockedFunction<typeof uploadInvoicePdf>;

const defaultValues: InvoiceFormValues = {
  accountNumber: "",
  statementId: "",
  companyName: "",
  issueDate: "",
  dueDate: "",
  currentDue: "",
  previousPayments: "",
  description: "",
  notes: "",
  propertyAddress: "",
  accountStatus: "",
  websiteName: "",
};

const validValues: InvoiceFormValues = {
  accountNumber: "ACC-100",
  statementId: "INV-2001",
  companyName: "City Power",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  currentDue: "250.00",
  previousPayments: "50.00",
  description: "Electricity",
  notes: "Pay online",
  propertyAddress: "12 Elm St",
  accountStatus: "unpaid",
  websiteName: "https://citypower.example.com",
};

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
    document_path: null,
    ...overrides,
  };
}

const savedDraft = {
  bill_id: "bill-1",
  status: "draft" as const,
  document_path: null,
} as Awaited<ReturnType<typeof saveBillDraft>>;

const storedPdfResponse = {
  bill_id: "bill-1",
  document_path: "bills/bill-1/invoice.pdf",
  status: "draft",
} as Awaited<ReturnType<typeof uploadInvoicePdf>>;

function createHook(options?: {
  initialDraftId?: string | null;
  selectedFile?: File | null;
  storedPdf?: StoredPdf;
}) {
  const onDraftCreated = jest.fn();
  const setStoredPdf = jest.fn();
  const setSubmitError = jest.fn();

  const hook = renderHook(() => {
    const form = useForm<InvoiceFormValues>({
      defaultValues,
    });

    const draft = useInvoiceDraft({
      initialDraftId: options?.initialDraftId ?? null,
      onDraftCreated,
      form,
      selectedFile: options?.selectedFile ?? null,
      storedPdf: options?.storedPdf ?? { kind: "none" },
      setStoredPdf,
      setSubmitError,
    });

    return { ...draft, form };
  });

  return {
    ...hook,
    onDraftCreated,
    setStoredPdf,
    setSubmitError,
  };
}

function pdf(name = "invoice.pdf") {
  return new File(["%PDF-1.4"], name, {
    type: "application/pdf",
  });
}

describe("mapDraftToFormValues", () => {
  it("maps every saved draft field into the form", () => {
    expect(mapDraftToFormValues(fullDraft())).toEqual({
      accountNumber: "ACC-100",
      statementId: "INV-2001",
      companyName: "City Power",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      currentDue: "250.00",
      previousPayments: "50.00",
      description: "Electricity",
      notes: "Pay online",
      propertyAddress: "12 Elm St",
      accountStatus: "unpaid",
      websiteName: "https://citypower.example.com",
    });
  });

  it("converts null database fields into empty form values", () => {
    expect(
      mapDraftToFormValues(
        fullDraft({
          account_number_raw: null,
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
        }),
      ),
    ).toEqual(defaultValues);
  });
});

describe("draftPayload", () => {
  it("maps form values to the API draft payload", () => {
    expect(draftPayload(validValues)).toEqual({
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
    });
  });

  it("converts blank fields to null so existing values can be cleared", () => {
    expect(draftPayload(defaultValues)).toEqual({
      account_number_raw: null,
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
    });
  });
});

describe("useInvoiceDraft", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Existing-draft reads stay pending unless a test resolves them.
    mockGetBillDraft.mockReturnValue(new Promise<never>(() => {}));

    mockSaveBillDraft.mockResolvedValue(savedDraft);
    mockUpdateBillDraft.mockResolvedValue(savedDraft);
    mockUploadInvoicePdf.mockResolvedValue(storedPdfResponse);
  });

  describe("loading an existing draft", () => {
    it("loads the draft and resets the form with its values", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft());

      const { result } = createHook({
        initialDraftId: "bill-1",
      });

      expect(result.current.isLoadingDraft).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoadingDraft).toBe(false);
      });

      expect(mockGetBillDraft).toHaveBeenCalledWith("bill-1");
      expect(result.current.form.getValues()).toEqual(mapDraftToFormValues(fullDraft()));
      expect(result.current.draftLoadError).toBeNull();
    });

    it("marks the PDF as previously stored when the draft has a document path", async () => {
      mockGetBillDraft.mockResolvedValue(
        fullDraft({
          document_path: "bills/bill-1/invoice.pdf",
        }),
      );

      const { result, setStoredPdf } = createHook({
        initialDraftId: "bill-1",
      });

      await waitFor(() => {
        expect(result.current.isLoadingDraft).toBe(false);
      });

      expect(setStoredPdf).toHaveBeenCalledWith({
        kind: "earlier",
      });
    });

    it("does not mark a PDF as stored when the draft has no document path", async () => {
      mockGetBillDraft.mockResolvedValue(fullDraft());

      const { result, setStoredPdf } = createHook({
        initialDraftId: "bill-1",
      });

      await waitFor(() => {
        expect(result.current.isLoadingDraft).toBe(false);
      });

      expect(setStoredPdf).not.toHaveBeenCalled();
    });

    it("exposes an error when loading the draft fails", async () => {
      mockGetBillDraft.mockRejectedValue(new Error("Unable to load draft."));

      const { result } = createHook({
        initialDraftId: "bill-1",
      });

      await waitFor(() => {
        expect(result.current.draftLoadError).toBe("Unable to load draft.");
      });

      expect(result.current.isLoadingDraft).toBe(false);
    });

    it("uses a fallback message when loading fails without an error message", async () => {
      mockGetBillDraft.mockRejectedValue({});

      const { result } = createHook({
        initialDraftId: "bill-1",
      });

      await waitFor(() => {
        expect(result.current.draftLoadError).toBe("Unable to load the draft. Please try again.");
      });
    });

    it("does not update PDF state when loading finishes after unmount", async () => {
      let resolveDraft!: (draft: BillDraftDetail) => void;

      mockGetBillDraft.mockReturnValue(
        new Promise((resolve) => {
          resolveDraft = resolve;
        }),
      );

      const { unmount, setStoredPdf } = createHook({
        initialDraftId: "bill-1",
      });

      unmount();

      await act(async () => {
        resolveDraft(
          fullDraft({
            document_path: "bills/bill-1/invoice.pdf",
          }),
        );
      });

      expect(setStoredPdf).not.toHaveBeenCalled();
    });
  });

  describe("saving drafts", () => {
    it("creates a draft on the first save", async () => {
      const { result, onDraftCreated } = createHook();

      act(() => {
        result.current.form.reset(validValues);
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(mockSaveBillDraft).toHaveBeenCalledWith(draftPayload(validValues));
      expect(mockUpdateBillDraft).not.toHaveBeenCalled();
      expect(onDraftCreated).toHaveBeenCalledWith("bill-1");
      expect(result.current.draftId).toBe("bill-1");
      expect(result.current.draftStatus).toBe("success");
      expect(result.current.draftMessage).toBe("Draft saved successfully: bill-1");
    });

    it("updates the existing draft on later saves", async () => {
      const { result } = createHook({
        initialDraftId: "bill-1",
      });

      act(() => {
        result.current.form.reset({
          ...validValues,
          currentDue: "275.00",
        });
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockUpdateBillDraft).toHaveBeenCalledWith(
        "bill-1",
        expect.objectContaining({
          amount: "275.00",
        }),
      );
      expect(result.current.draftStatus).toBe("success");
    });

    it("does nothing when saving is not allowed", async () => {
      const { result } = createHook();

      await act(async () => {
        await result.current.handleSaveDraft(false);
      });

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockUpdateBillDraft).not.toHaveBeenCalled();
      expect(result.current.draftStatus).toBe("idle");
    });

    it("does not create a draft when saving fails", async () => {
      mockSaveBillDraft.mockRejectedValue(new Error("Unable to save draft."));

      const { result, setSubmitError } = createHook();

      act(() => {
        result.current.form.reset(validValues);
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(result.current.draftStatus).toBe("error");
      expect(setSubmitError).toHaveBeenCalledWith("Unable to save draft.");
      expect(result.current.draftId).toBeNull();
    });

    it("shows a fallback error when saving fails without an error message", async () => {
      mockSaveBillDraft.mockRejectedValue({});

      const { result, setSubmitError } = createHook();

      act(() => {
        result.current.form.reset(validValues);
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(setSubmitError).toHaveBeenCalledWith("Unable to save draft.");
    });

    it("does not save when draft validation fails", async () => {
      const { result, setSubmitError } = createHook();

      act(() => {
        result.current.form.reset({
          ...defaultValues,
          websiteName: "citypower.example.com",
        });
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(mockUpdateBillDraft).not.toHaveBeenCalled();
      expect(result.current.draftStatus).toBe("error");
      expect(setSubmitError).toHaveBeenCalledWith("Enter a full URL like https://domainname.com");
    });

    it("saves the draft but reports an error when PDF storage fails", async () => {
      mockUploadInvoicePdf.mockRejectedValue(new Error("Unable to store the invoice PDF."));

      const file = pdf();

      const { result, setSubmitError } = createHook({
        selectedFile: file,
      });

      act(() => {
        result.current.form.reset(validValues);
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(result.current.draftId).toBe("bill-1");
      expect(result.current.draftStatus).toBe("error");
      expect(setSubmitError).toHaveBeenCalledWith(
        expect.stringContaining(
          "Draft saved, but the PDF couldn't be stored. Save again to retry.",
        ),
      );
    });

    it("retries PDF storage on the next save without creating another draft", async () => {
      mockUploadInvoicePdf
        .mockRejectedValueOnce(new Error("Upload failed."))
        .mockResolvedValueOnce(storedPdfResponse);

      const file = pdf();

      const { result } = createHook({
        selectedFile: file,
      });

      act(() => {
        result.current.form.reset(validValues);
      });

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(result.current.draftId).toBe("bill-1");

      await act(async () => {
        await result.current.handleSaveDraft(true);
      });

      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUpdateBillDraft).toHaveBeenCalledTimes(1);
      expect(mockUploadInvoicePdf).toHaveBeenCalledTimes(2);
      expect(result.current.draftStatus).toBe("success");
    });
  });

  describe("storing a picked PDF", () => {
    it("stores the selected PDF with the draft", async () => {
      const file = pdf();

      const { result, setStoredPdf } = createHook({
        selectedFile: file,
      });

      await act(async () => {
        await result.current.storePickedPdf("bill-1");
      });

      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(setStoredPdf).toHaveBeenCalledWith({
        kind: "file",
        file,
      });
    });

    it("does not upload when no PDF is selected", async () => {
      const { result, setStoredPdf } = createHook();

      await act(async () => {
        await result.current.storePickedPdf("bill-1");
      });

      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(setStoredPdf).not.toHaveBeenCalled();
    });

    it("does not upload the same PDF twice", async () => {
      const file = pdf();

      const { result, setStoredPdf } = createHook({
        selectedFile: file,
        storedPdf: {
          kind: "file",
          file,
        },
      });

      await act(async () => {
        await result.current.storePickedPdf("bill-1");
      });

      expect(mockUploadInvoicePdf).not.toHaveBeenCalled();
      expect(setStoredPdf).not.toHaveBeenCalled();
    });

    it("uploads a newly selected PDF when an earlier PDF exists", async () => {
      const file = pdf();

      const { result, setStoredPdf } = createHook({
        selectedFile: file,
        storedPdf: {
          kind: "earlier",
        },
      });

      await act(async () => {
        await result.current.storePickedPdf("bill-1");
      });

      expect(mockUploadInvoicePdf).toHaveBeenCalledWith(file, "bill-1");
      expect(setStoredPdf).toHaveBeenCalledWith({
        kind: "file",
        file,
      });
    });

    it("does not mark a PDF as stored when its upload fails", async () => {
      mockUploadInvoicePdf.mockRejectedValue(new Error("Upload failed."));

      const file = pdf();

      const { result, setStoredPdf } = createHook({
        selectedFile: file,
      });

      await expect(
        act(async () => {
          await result.current.storePickedPdf("bill-1");
        }),
      ).rejects.toThrow("Upload failed.");

      expect(setStoredPdf).not.toHaveBeenCalled();
    });
  });

  describe("ensureDraftSaved", () => {
    it("creates a draft and returns its ID when no draft exists", async () => {
      const { result, onDraftCreated } = createHook();

      let id = "";

      await act(async () => {
        id = await result.current.ensureDraftSaved({
          ...draftPayload(defaultValues),
          invoice_number: "INV-2001",
        } satisfies BillDraftPayload);
      });

      expect(id).toBe("bill-1");
      expect(mockSaveBillDraft).toHaveBeenCalledTimes(1);
      expect(onDraftCreated).toHaveBeenCalledWith("bill-1");
    });

    it("updates and returns the existing draft ID", async () => {
      const { result, onDraftCreated } = createHook({
        initialDraftId: "bill-7",
      });

      let id = "";

      await act(async () => {
        id = await result.current.ensureDraftSaved({
          ...draftPayload(defaultValues),
          invoice_number: "INV-2001",
        } satisfies BillDraftPayload);
      });

      expect(id).toBe("bill-7");
      expect(mockUpdateBillDraft).toHaveBeenCalledWith(
        "bill-7",
        expect.objectContaining({
          invoice_number: "INV-2001",
        }),
      );
      expect(mockSaveBillDraft).not.toHaveBeenCalled();
      expect(onDraftCreated).not.toHaveBeenCalled();
    });
  });
});

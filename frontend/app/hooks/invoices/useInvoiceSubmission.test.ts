import { act, renderHook } from "@testing-library/react";
import { submitBill } from "@/lib/api/bills";
import { ApiError } from "@/lib/api/http";
import type { InvoiceFormValues } from "@/lib/invoice-form-schema";
import type { BillCreatePayload, BillDraftPayload } from "@/types/bill";
import { useInvoiceSubmission } from "./useInvoiceSubmission";

jest.mock("@/lib/api/bills", () => ({
  submitBill: jest.fn(),
}));

const mockSubmitBill = submitBill as jest.MockedFunction<typeof submitBill>;
const mockSubmittedBill = {} as unknown as Awaited<ReturnType<typeof submitBill>>;

const ALREADY_SUBMITTED_MESSAGE =
  "This bill was already sent for approval with the earlier values, so your latest changes weren't saved. Open it from the dashboard to check what was sent.";

// The message the API sends when the bill itself was already submitted.
const ALREADY_SUBMITTED_API_MESSAGE = "This bill has already been submitted.";

const DUPLICATE_INVOICE_MESSAGE =
  "This invoice number is already in the system for this vendor account.";

const defaultValues: InvoiceFormValues = {
  accountNumber: " ACC-100 ",
  statementId: " INV-2001 ",
  companyName: " City Power ",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  currentDue: " 250.00 ",
  previousPayments: " 50.00 ",
  description: " Electricity ",
  notes: " Pay online ",
  propertyAddress: "12 Elm St",
  accountStatus: "unpaid",
  websiteName: "https://citypower.example.com",
  vendorAccountId: "",
};

const expectedPayload: BillCreatePayload = {
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
  vendor_account_id: undefined,
};

const draftId = "bill-1";

function pdf(name = "invoice.pdf") {
  return new File(["%PDF-1.4"], name, {
    type: "application/pdf",
  });
}

// Creates an error that passes `instanceof ApiError` without
// depending on the ApiError constructor's argument signature.
function apiError(status: number, message: string) {
  return Object.assign(Object.create(ApiError.prototype), {
    status,
    message,
  }) as ApiError;
}

function createHook(options?: { selectedFile?: File | null }) {
  const ensureDraftSaved = jest.fn<Promise<string>, [BillDraftPayload]>();
  const storePickedPdf = jest.fn<Promise<void>, [string]>();
  const onSuccess = jest.fn();
  const setSubmitError = jest.fn();

  ensureDraftSaved.mockResolvedValue(draftId);
  storePickedPdf.mockResolvedValue(undefined);

  mockSubmitBill.mockResolvedValue(mockSubmittedBill);

  const hook = renderHook(
    ({ selectedFile }: { selectedFile: File | null }) =>
      useInvoiceSubmission({
        selectedFile,
        ensureDraftSaved,
        storePickedPdf,
        onSuccess,
        setSubmitError,
      }),
    {
      initialProps: {
        selectedFile: options?.selectedFile ?? null,
      },
    },
  );

  return {
    ...hook,
    ensureDraftSaved,
    storePickedPdf,
    onSuccess,
    setSubmitError,
  };
}

describe("useInvoiceSubmission", () => {
  beforeEach(() => {
    // resetAllMocks also clears queued mockXOnce values, so a test that
    // fails early can't leak them into the next one.
    jest.resetAllMocks();
    mockSubmitBill.mockResolvedValue(mockSubmittedBill);
  });

  describe("initial state", () => {
    it("starts with an idle submission status", () => {
      const { result } = createHook();

      expect(result.current.createStatus).toBe("idle");
    });
  });

  describe("successful submission", () => {
    it("saves the draft, stores the PDF, and submits the bill", async () => {
      const file = pdf();

      const { result, ensureDraftSaved, storePickedPdf, onSuccess, setSubmitError } = createHook({
        selectedFile: file,
      });

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(ensureDraftSaved).toHaveBeenCalledTimes(1);
      expect(storePickedPdf).toHaveBeenCalledWith(draftId);
      expect(mockSubmitBill).toHaveBeenCalledWith(draftId, expectedPayload);

      expect(result.current.createStatus).toBe("success");
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(setSubmitError).toHaveBeenCalledWith("");
    });

    it("saves the draft first, then stores the PDF, then submits", async () => {
      const { result, ensureDraftSaved, storePickedPdf } = createHook({
        selectedFile: pdf(),
      });

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      const saveOrder = ensureDraftSaved.mock.invocationCallOrder[0];
      const storeOrder = storePickedPdf.mock.invocationCallOrder[0];
      const submitOrder = mockSubmitBill.mock.invocationCallOrder[0];

      expect(saveOrder).toBeLessThan(storeOrder);
      expect(storeOrder).toBeLessThan(submitOrder);
    });

    it("passes the draft payload to ensureDraftSaved", async () => {
      const { result, ensureDraftSaved } = createHook();

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(ensureDraftSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice_number: " INV-2001 ",
          account_number_raw: " ACC-100 ",
          amount: " 250.00 ",
          vendor_account_id: null,
        }),
      );
    });

    it("submits to the ID that ensureDraftSaved returns", async () => {
      const { result, ensureDraftSaved, storePickedPdf } = createHook();

      ensureDraftSaved.mockResolvedValue("bill-42");

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(storePickedPdf).toHaveBeenCalledWith("bill-42");
      expect(mockSubmitBill).toHaveBeenCalledWith("bill-42", expectedPayload);
    });

    it("calls onSuccess only after submission succeeds", async () => {
      let resolveSubmission!: (value: Awaited<ReturnType<typeof submitBill>>) => void;

      const { result, onSuccess } = createHook();

      mockSubmitBill.mockReturnValue(
        new Promise((resolve) => {
          resolveSubmission = resolve;
        }),
      );

      let submission!: Promise<void>;

      act(() => {
        submission = result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("loading");
      expect(onSuccess).not.toHaveBeenCalled();

      await act(async () => {
        resolveSubmission(mockSubmittedBill);
        await submission;
      });

      expect(result.current.createStatus).toBe("success");
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it("trims optional values and omits empty optional fields", async () => {
      const values: InvoiceFormValues = {
        ...defaultValues,
        companyName: "  ",
        previousPayments: "  ",
        description: "  ",
        notes: "  ",
        accountStatus: "",
        websiteName: "",
      };

      const { result } = createHook();

      await act(async () => {
        await result.current.handleCreate(values);
      });

      expect(mockSubmitBill).toHaveBeenCalledWith(
        draftId,
        expect.objectContaining({
          account_number_raw: "ACC-100",
          invoice_number: "INV-2001",
          vendor_name_raw: undefined,
          prev_payments: undefined,
          description: undefined,
          processing_notes: undefined,
          account_status: undefined,
          website_name: undefined,
        }),
      );
    });

    it("sends the picked vendor account", async () => {
      const { result } = createHook();

      await act(async () => {
        await result.current.handleCreate({
          ...defaultValues,
          vendorAccountId: "vendor-7",
        });
      });

      expect(mockSubmitBill).toHaveBeenCalledWith(
        draftId,
        expect.objectContaining({ vendor_account_id: "vendor-7" }),
      );
    });

    it("omits the vendor account when none was picked", async () => {
      const { result } = createHook();

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(mockSubmitBill.mock.calls[0][1].vendor_account_id).toBeUndefined();
    });
  });

  describe("draft saving failures", () => {
    it("does not submit when saving the draft fails", async () => {
      const { result, ensureDraftSaved, storePickedPdf, onSuccess, setSubmitError } = createHook();

      ensureDraftSaved.mockRejectedValue(new Error("Unable to save the draft."));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(storePickedPdf).not.toHaveBeenCalled();
      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith("Unable to save the draft.");
    });

    it("uses a fallback message when draft saving fails without an error message", async () => {
      const { result, ensureDraftSaved, setSubmitError } = createHook();

      ensureDraftSaved.mockRejectedValue({});

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(
        "Unable to create the bill. Please try again.",
      );
      expect(mockSubmitBill).not.toHaveBeenCalled();
    });
  });

  describe("PDF storage failures", () => {
    it("does not submit when storing the PDF fails", async () => {
      const { result, storePickedPdf, onSuccess, setSubmitError } = createHook({
        selectedFile: pdf(),
      });

      storePickedPdf.mockRejectedValue(new Error("Upload failed."));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(mockSubmitBill).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(
        "The PDF couldn't be stored, so the bill wasn't created. Please try again.\nUpload failed.",
      );
    });

    it("uses a fallback message when PDF storage fails without an error message", async () => {
      const { result, storePickedPdf, setSubmitError } = createHook();

      storePickedPdf.mockRejectedValue({});

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(
        "The PDF couldn't be stored, so the bill wasn't created. Please try again.",
      );

      expect(mockSubmitBill).not.toHaveBeenCalled();
    });
  });

  describe("submission failures", () => {
    it("shows the API error message when submission fails", async () => {
      const { result, onSuccess, setSubmitError } = createHook();

      mockSubmitBill.mockRejectedValue(new Error("Server unavailable."));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith("Server unavailable.");
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("uses a fallback message when submission fails without an error message", async () => {
      const { result, setSubmitError } = createHook();

      mockSubmitBill.mockRejectedValue({});

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(
        "Unable to create the bill. Please try again.",
      );
    });

    it("shows the already-submitted message for an already-submitted 409 on the first attempt", async () => {
      const { result, setSubmitError, onSuccess } = createHook();

      mockSubmitBill.mockRejectedValue(apiError(409, ALREADY_SUBMITTED_API_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(ALREADY_SUBMITTED_MESSAGE);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("shows the server's message for a duplicate-invoice 409", async () => {
      const { result, setSubmitError, onSuccess } = createHook();

      mockSubmitBill.mockRejectedValue(apiError(409, DUPLICATE_INVOICE_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(DUPLICATE_INVOICE_MESSAGE);
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe("retrying an unanswered submission", () => {
    it("treats a matching already-submitted 409 retry as a successful submission", async () => {
      const { result, onSuccess, setSubmitError } = createHook();

      mockSubmitBill
        .mockRejectedValueOnce(new Error("Network connection lost."))
        .mockRejectedValueOnce(apiError(409, ALREADY_SUBMITTED_API_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(onSuccess).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("success");
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(setSubmitError).toHaveBeenLastCalledWith("");
      expect(mockSubmitBill).toHaveBeenCalledTimes(2);
    });

    it("does not treat a duplicate-invoice 409 retry as a successful submission", async () => {
      const { result, onSuccess, setSubmitError } = createHook();

      mockSubmitBill
        .mockRejectedValueOnce(new Error("Network connection lost."))
        .mockRejectedValueOnce(apiError(409, DUPLICATE_INVOICE_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(onSuccess).not.toHaveBeenCalled();
      expect(setSubmitError).toHaveBeenLastCalledWith(DUPLICATE_INVOICE_MESSAGE);
    });

    it("does not treat a 409 as success when the submitted values changed", async () => {
      const { result, setSubmitError, onSuccess } = createHook();

      mockSubmitBill
        .mockRejectedValueOnce(new Error("Network connection lost."))
        .mockRejectedValueOnce(apiError(409, ALREADY_SUBMITTED_API_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      const changedValues = {
        ...defaultValues,
        currentDue: "300.00",
      };

      await act(async () => {
        await result.current.handleCreate(changedValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(ALREADY_SUBMITTED_MESSAGE);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("does not treat a 409 as success when the selected PDF changed", async () => {
      const firstFile = pdf("first.pdf");
      const secondFile = pdf("second.pdf");

      const { result, rerender, onSuccess, setSubmitError } = createHook({
        selectedFile: firstFile,
      });

      mockSubmitBill
        .mockRejectedValueOnce(new Error("Network connection lost."))
        .mockRejectedValueOnce(apiError(409, ALREADY_SUBMITTED_API_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      rerender({ selectedFile: secondFile });

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(onSuccess).not.toHaveBeenCalled();
      expect(setSubmitError).toHaveBeenLastCalledWith(ALREADY_SUBMITTED_MESSAGE);
    });

    it("does not treat a 404 API error as an unanswered network failure", async () => {
      const { result, setSubmitError, onSuccess } = createHook();

      mockSubmitBill
        .mockRejectedValueOnce(apiError(404, "Not found"))
        .mockRejectedValueOnce(apiError(409, ALREADY_SUBMITTED_API_MESSAGE));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(onSuccess).not.toHaveBeenCalled();
      expect(setSubmitError).toHaveBeenLastCalledWith(ALREADY_SUBMITTED_MESSAGE);
    });
  });

  describe("PDF storage after an unanswered submission", () => {
    it("shows the already-submitted message when PDF storage returns 404 after a network failure", async () => {
      const { result, storePickedPdf, setSubmitError, onSuccess } = createHook();

      mockSubmitBill.mockRejectedValueOnce(new Error("Network connection lost."));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      storePickedPdf.mockRejectedValueOnce(apiError(404, "Not found"));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(ALREADY_SUBMITTED_MESSAGE);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("shows the already-submitted message when PDF storage returns 409 after a network failure", async () => {
      const { result, storePickedPdf, setSubmitError } = createHook();

      mockSubmitBill.mockRejectedValueOnce(new Error("Network connection lost."));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      storePickedPdf.mockRejectedValueOnce(apiError(409, "Conflict"));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(ALREADY_SUBMITTED_MESSAGE);
    });

    it("shows the ordinary PDF error when there was no unanswered submission", async () => {
      const { result, storePickedPdf, setSubmitError } = createHook();

      storePickedPdf.mockRejectedValue(apiError(409, "Conflict"));

      await act(async () => {
        await result.current.handleCreate(defaultValues);
      });

      expect(result.current.createStatus).toBe("error");
      expect(setSubmitError).toHaveBeenLastCalledWith(
        "The PDF couldn't be stored, so the bill wasn't created. Please try again.\nConflict",
      );
    });
  });
});

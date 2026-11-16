import { act, renderHook, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { extractBill } from "@/lib/api/bills";
import { clearedValues, errorBanner, planFill, READING_MESSAGE } from "@/lib/extraction";
import type { InvoiceFormValues } from "@/lib/invoice-form-schema";
import { type ReaderState, useInvoiceExtraction } from "./useInvoiceExtraction";

jest.mock("@/lib/api/bills", () => ({
  extractBill: jest.fn(),
}));

jest.mock("@/lib/extraction", () => ({
  clearedValues: jest.fn(),
  errorBanner: jest.fn(),
  planFill: jest.fn(),
  READING_MESSAGE: "Reading invoice...",
}));

const mockExtractBill = extractBill as jest.MockedFunction<typeof extractBill>;

const mockPlanFill = planFill as jest.MockedFunction<typeof planFill>;
const mockClearedValues = clearedValues as jest.MockedFunction<typeof clearedValues>;
const mockErrorBanner = errorBanner as jest.MockedFunction<typeof errorBanner>;

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

function pdf(name = "invoice.pdf") {
  return new File(["%PDF-1.4"], name, {
    type: "application/pdf",
  });
}

function createHook() {
  const onEdited = jest.fn();

  const hook = renderHook(() => {
    const form = useForm<InvoiceFormValues>({
      defaultValues,
    });

    const extraction = useInvoiceExtraction({
      form,
      onEdited,
    });

    return {
      ...extraction,
      form,
    };
  });

  return {
    ...hook,
    onEdited,
  };
}

function extractionBanner() {
  return {
    type: "success",
    message: "Invoice read successfully.",
  } as never;
}

function extractionNotes() {
  return {
    statementId: "High confidence",
    companyName: "Medium confidence",
  } as never;
}

describe("useInvoiceExtraction", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockExtractBill.mockResolvedValue({} as Awaited<ReturnType<typeof extractBill>>);

    mockPlanFill.mockReturnValue({
      values: {},
      notes: {},
      banner: extractionBanner(),
    } as ReturnType<typeof planFill>);

    mockClearedValues.mockReturnValue({} as ReturnType<typeof clearedValues>);

    mockErrorBanner.mockReturnValue(extractionBanner());
  });

  describe("initial state", () => {
    it("starts in the idle state with no extraction notes", () => {
      const { result } = createHook();

      expect(result.current.reader).toEqual({
        phase: "idle",
      });
      expect(result.current.notes).toEqual({});
    });

    it("exposes the reading message", () => {
      const { result } = createHook();

      expect(result.current.readingMessage).toBe(READING_MESSAGE);
    });
  });

  describe("reading an invoice", () => {
    it("sets the reader to reading while extraction is in progress", async () => {
      let resolveExtraction!: (value: Awaited<ReturnType<typeof extractBill>>) => void;

      mockExtractBill.mockReturnValue(
        new Promise((resolve) => {
          resolveExtraction = resolve;
        }),
      );

      const { result } = createHook();
      const file = pdf();

      let readPromise!: Promise<void>;

      act(() => {
        readPromise = result.current.readInvoice(file);
      });

      expect(result.current.reader).toEqual({
        phase: "reading",
      });
      expect(mockExtractBill).toHaveBeenCalledWith(file, expect.any(AbortSignal));

      await act(async () => {
        resolveExtraction({} as Awaited<ReturnType<typeof extractBill>>);
        await readPromise;
      });

      expect(result.current.reader.phase).toBe("done");
    });

    it("applies extracted values to the form", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
          companyName: "City Power",
          currentDue: "250.00",
        },
        notes: extractionNotes(),
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result, onEdited } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.form.getValues()).toMatchObject({
        statementId: "INV-2001",
        companyName: "City Power",
        currentDue: "250.00",
      });

      expect(result.current.notes).toEqual(extractionNotes());
      expect(result.current.reader).toEqual({
        phase: "done",
        banner: extractionBanner(),
      });
      expect(onEdited).toHaveBeenCalledTimes(1);
    });

    it("passes the current form values and replaceable fields to planFill", async () => {
      const { result } = createHook();

      act(() => {
        result.current.form.setValue("statementId", "MANUAL-100");
      });

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(mockPlanFill).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          statementId: "MANUAL-100",
        }),
        expect.any(Set),
      );

      const replaceableFields = mockPlanFill.mock.calls[0][2];

      expect(replaceableFields).not.toContain("statementId");
    });

    it("allows previously extracted values to be replaced when unchanged by the user", async () => {
      mockPlanFill
        .mockReturnValueOnce({
          values: {
            statementId: "INV-2001",
          },
          notes: {},
          banner: extractionBanner(),
        } as ReturnType<typeof planFill>)
        .mockReturnValueOnce({
          values: {
            statementId: "INV-3001",
          },
          notes: {},
          banner: extractionBanner(),
        } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.form.getValues("statementId")).toBe("INV-2001");

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      const replaceableFields = mockPlanFill.mock.calls[1][2];

      expect(replaceableFields).toContain("statementId");
      expect(result.current.form.getValues("statementId")).toBe("INV-3001");
    });

    it("does not allow a manually edited extracted value to be replaced", async () => {
      mockPlanFill
        .mockReturnValueOnce({
          values: {
            statementId: "INV-2001",
          },
          notes: {},
          banner: extractionBanner(),
        } as ReturnType<typeof planFill>)
        .mockImplementationOnce((_result, _current, replaceableFields) => ({
          values: replaceableFields?.has("statementId") ? { statementId: "INV-3001" } : {},
          notes: {},
          banner: extractionBanner(),
        }));

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      act(() => {
        result.current.form.setValue("statementId", "MY-MANUAL-VALUE");
      });

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      const replaceableFields = mockPlanFill.mock.calls[1][2];

      expect(replaceableFields).not.toContain("statementId");
      expect(result.current.form.getValues("statementId")).toBe("MY-MANUAL-VALUE");
    });
    it("does not call onEdited when no fields are filled", async () => {
      mockPlanFill.mockReturnValue({
        values: {},
        notes: {},
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result, onEdited } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(onEdited).not.toHaveBeenCalled();
    });

    it("calls onEdited when extracted values are applied", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          companyName: "City Power",
        },
        notes: {},
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result, onEdited } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(onEdited).toHaveBeenCalledTimes(1);
    });
  });

  describe("field notes", () => {
    it("stores extraction notes returned by planFill", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
        },
        notes: extractionNotes(),
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.notes).toEqual(extractionNotes());
    });

    it("clears a field note when that field is edited", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
          companyName: "City Power",
        },
        notes: extractionNotes(),
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.notes).toEqual(extractionNotes());

      act(() => {
        result.current.clearFieldNote("statementId");
      });

      expect(result.current.notes).toEqual({
        companyName: "Medium confidence",
      });
    });

    it("does not change notes when clearing a field without a note", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
        },
        notes: extractionNotes(),
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      act(() => {
        result.current.clearFieldNote("description");
      });

      expect(result.current.notes).toEqual(extractionNotes());
    });

    it("clears extraction notes when a new read starts", async () => {
      let resolveExtraction!: (value: Awaited<ReturnType<typeof extractBill>>) => void;

      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
        },
        notes: extractionNotes(),
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.notes).toEqual(extractionNotes());

      mockExtractBill.mockReturnValue(
        new Promise((resolve) => {
          resolveExtraction = resolve;
        }),
      );

      let secondRead!: Promise<void>;

      act(() => {
        secondRead = result.current.readInvoice(pdf("second.pdf"));
      });

      // Notes should be cleared immediately when the new read starts.
      expect(result.current.reader).toEqual({
        phase: "reading",
      });
      expect(result.current.notes).toEqual({});

      await act(async () => {
        resolveExtraction({} as Awaited<ReturnType<typeof extractBill>>);
        await secondRead;
      });
    });
  });

  describe("extraction errors", () => {
    it("clears replaceable extracted values when extraction fails", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
        },
        notes: {},
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.form.getValues("statementId")).toBe("INV-2001");

      mockExtractBill.mockRejectedValue(new Error("Unable to process invoice."));

      mockClearedValues.mockReturnValue({
        statementId: "",
      } as ReturnType<typeof clearedValues>);

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(mockClearedValues).toHaveBeenCalledWith(expect.any(Set));
      expect(result.current.form.getValues("statementId")).toBe("");
    });

    it("shows an error banner when extraction fails", async () => {
      mockExtractBill.mockRejectedValue(new Error("Unable to process invoice."));

      const banner = {
        type: "error",
        message: "Unable to process invoice.",
      } as never;

      mockErrorBanner.mockReturnValue(banner);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(mockErrorBanner).toHaveBeenCalledWith("Unable to process invoice.");
      expect(result.current.reader).toEqual({
        phase: "done",
        banner,
      });
    });
  });

  it("uses a fallback error message when the thrown value is not an Error", async () => {
    mockExtractBill.mockRejectedValue("Unexpected failure");

    const { result } = createHook();

    await act(async () => {
      await result.current.readInvoice(pdf());
    });

    expect(mockErrorBanner).toHaveBeenCalledWith("Unable to read the invoice.");
  });

  it("does not clear manually edited values when extraction fails", async () => {
    mockPlanFill.mockReturnValue({
      values: {
        statementId: "INV-2001",
      },
      notes: {},
      banner: extractionBanner(),
    } as ReturnType<typeof planFill>);

    const { result } = createHook();

    await act(async () => {
      await result.current.readInvoice(pdf());
    });

    act(() => {
      result.current.form.setValue("statementId", "MY-MANUAL-VALUE");
    });

    mockExtractBill.mockRejectedValue(new Error("Unable to process invoice."));

    mockClearedValues.mockImplementation((replaceableFields) => {
      return (replaceableFields.has("statementId") ? { statementId: "" } : {}) as ReturnType<
        typeof clearedValues
      >;
    });

    await act(async () => {
      await result.current.readInvoice(pdf());
    });

    expect(mockClearedValues).toHaveBeenCalledWith(
      expect.not.objectContaining({
        statementId: expect.anything(),
      }),
    );

    expect(result.current.form.getValues("statementId")).toBe("MY-MANUAL-VALUE");
  });

  describe("resetting extraction", () => {
    it("resets the reader to idle and clears notes", async () => {
      mockPlanFill.mockReturnValue({
        values: {
          statementId: "INV-2001",
        },
        notes: extractionNotes(),
        banner: extractionBanner(),
      } as ReturnType<typeof planFill>);

      const { result } = createHook();

      await act(async () => {
        await result.current.readInvoice(pdf());
      });

      expect(result.current.reader.phase).toBe("done");
      expect(result.current.notes).toEqual(extractionNotes());

      act(() => {
        result.current.resetReader();
      });

      expect(result.current.reader).toEqual({
        phase: "idle",
      });
      expect(result.current.notes).toEqual({});
    });

    it("supports resetting to a supplied reader state", () => {
      const { result } = createHook();

      const nextState: ReaderState = {
        phase: "reading",
      };

      act(() => {
        result.current.resetReader(nextState);
      });

      expect(result.current.reader).toEqual(nextState);
    });
  });

  describe("aborting extraction", () => {
    it("aborts an in-progress extraction when resetReader is called", async () => {
      let capturedSignal!: AbortSignal;

      mockExtractBill.mockImplementation((_file, signal) => {
        capturedSignal = signal!;

        return new Promise(() => {});
      });

      const { result } = createHook();

      act(() => {
        void result.current.readInvoice(pdf());
      });

      expect(capturedSignal.aborted).toBe(false);

      act(() => {
        result.current.resetReader();
      });

      expect(capturedSignal.aborted).toBe(true);
      expect(result.current.reader).toEqual({
        phase: "idle",
      });
    });

    it("aborts the previous extraction when a new read starts", async () => {
      const signals: AbortSignal[] = [];

      mockExtractBill.mockImplementation((_file, signal) => {
        signals.push(signal!);

        return new Promise(() => {});
      });

      const { result } = createHook();

      act(() => {
        void result.current.readInvoice(pdf("first.pdf"));
      });

      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(false);

      act(() => {
        void result.current.readInvoice(pdf("second.pdf"));
      });

      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it("aborts an in-progress extraction when the hook unmounts", async () => {
      let capturedSignal!: AbortSignal;

      mockExtractBill.mockImplementation((_file, signal) => {
        capturedSignal = signal!;

        return new Promise(() => {});
      });

      const { result, unmount } = createHook();

      act(() => {
        void result.current.readInvoice(pdf());
      });

      expect(capturedSignal.aborted).toBe(false);

      unmount();

      expect(capturedSignal.aborted).toBe(true);
    });

    it("does not update the reader after an extraction is aborted", async () => {
      let rejectExtraction!: (error: Error) => void;
      let capturedSignal!: AbortSignal;

      mockExtractBill.mockImplementation((_file, signal) => {
        capturedSignal = signal!;

        return new Promise((_resolve, reject) => {
          rejectExtraction = reject;
        });
      });

      const { result } = createHook();

      let readPromise!: Promise<void>;

      act(() => {
        readPromise = result.current.readInvoice(pdf());
      });

      act(() => {
        result.current.resetReader();
      });

      expect(capturedSignal.aborted).toBe(true);

      await act(async () => {
        rejectExtraction(new Error("Request aborted."));
        await readPromise;
      });

      expect(result.current.reader).toEqual({
        phase: "idle",
      });
      expect(mockErrorBanner).not.toHaveBeenCalled();
    });
  });
});

"use client";

import { useRef, useState } from "react";

import { draftPayload } from "@/hooks/invoices/useInvoiceDraft";
import { submitBill } from "@/lib/api/bills";
import { ApiError } from "@/lib/api/http";
import type { InvoiceFormValues } from "@/lib/invoice-form-schema";
import type { BillCreatePayload, BillDraftPayload } from "@/types/bill";

export type SubmissionStatus = "idle" | "loading" | "success" | "error";

type UnansweredSubmit = {
  payload: string;
  pdf: File | null;
};

type UseInvoiceSubmissionOptions = {
  selectedFile: File | null;
  ensureDraftSaved: (payload: BillDraftPayload) => Promise<string>;
  storePickedPdf: (id: string) => Promise<void>;
  onSuccess: () => void;
  setSubmitError: (message: string) => void;
};

const ALREADY_SUBMITTED_MESSAGE =
  "This bill was already sent for approval with the earlier values, so your latest changes weren't saved. Open it from the dashboard to check what was sent.";

// The message the API sends when the bill itself was already submitted.
// Other 409s, such as a duplicate invoice number, are real failures.
const BILL_ALREADY_SUBMITTED_API_MESSAGE = "This bill has already been submitted.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isBillAlreadySubmitted(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.message === BILL_ALREADY_SUBMITTED_API_MESSAGE
  );
}

export function createBillPayload(values: InvoiceFormValues): BillCreatePayload {
  return {
    account_number_raw: values.accountNumber.trim(),
    invoice_number: values.statementId.trim(),
    vendor_name_raw: values.companyName.trim() || undefined,
    invoice_date: values.issueDate,
    due_date: values.dueDate,
    amount: values.currentDue.trim(),
    prev_payments: values.previousPayments.trim() || undefined,
    description: values.description.trim() || undefined,
    processing_notes: values.notes.trim() || undefined,
    property_address: values.propertyAddress,
    account_status: values.accountStatus || undefined,
    website_name: values.websiteName || undefined,
    vendor_account_id: values.vendorAccountId || undefined,
  };
}

export function useInvoiceSubmission({
  selectedFile,
  ensureDraftSaved,
  storePickedPdf,
  onSuccess,
  setSubmitError,
}: UseInvoiceSubmissionOptions) {
  const [createStatus, setCreateStatus] = useState<SubmissionStatus>("idle");

  const unansweredSubmits = useRef<UnansweredSubmit[]>([]);

  async function handleCreate(values: InvoiceFormValues): Promise<void> {
    setCreateStatus("loading");
    setSubmitError("");

    let id: string;

    try {
      // Update an existing draft too, not just a newly created one.
      id = await ensureDraftSaved(draftPayload(values));
    } catch (error) {
      setCreateStatus("error");
      setSubmitError(errorMessage(error, "Unable to create the bill. Please try again."));
      return;
    }

    try {
      await storePickedPdf(id);
    } catch (error) {
      setCreateStatus("error");

      const mayBeSubmitted =
        unansweredSubmits.current.length > 0 &&
        error instanceof ApiError &&
        (error.status === 404 || error.status === 409);

      setSubmitError(
        mayBeSubmitted
          ? ALREADY_SUBMITTED_MESSAGE
          : `The PDF couldn't be stored, so the bill wasn't created. Please try again.\n${errorMessage(error, "")}`.trim(),
      );
      return;
    }

    const payload = createBillPayload(values);

    const attempt: UnansweredSubmit = {
      payload: JSON.stringify(payload),
      pdf: selectedFile,
    };

    try {
      await submitBill(id, payload);
    } catch (error) {
      const alreadySubmitted = isBillAlreadySubmitted(error);

      const earlier = unansweredSubmits.current;

      const sameAsEarlier =
        earlier.length > 0 &&
        earlier.every((sent) => sent.payload === attempt.payload && sent.pdf === attempt.pdf);

      if (!(alreadySubmitted && sameAsEarlier)) {
        if (!(error instanceof ApiError)) {
          unansweredSubmits.current = [...earlier, attempt];
        }

        setCreateStatus("error");
        setSubmitError(
          alreadySubmitted
            ? ALREADY_SUBMITTED_MESSAGE
            : errorMessage(error, "Unable to create the bill. Please try again."),
        );
        return;
      }
    }

    setCreateStatus("success");
    onSuccess();
  }

  return {
    createStatus,
    handleCreate,
  };
}

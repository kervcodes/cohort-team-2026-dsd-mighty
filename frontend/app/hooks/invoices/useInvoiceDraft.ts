"use client";

import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { getBillDraft, saveBillDraft, updateBillDraft, uploadInvoicePdf } from "@/lib/api/bills";
import {
  type InvoiceDraftFormValues,
  type InvoiceFormValues,
  invoiceDraftFormSchema,
} from "@/lib/invoice-form-schema";
import type { BillDraftDetail, BillDraftPayload } from "@/types/bill";

export type DraftActionStatus = "idle" | "loading" | "success" | "error";

export type StoredPdf = { kind: "none" } | { kind: "earlier" } | { kind: "file"; file: File };

type UseInvoiceDraftOptions = {
  initialDraftId: string | null;
  onDraftCreated: (draftId: string) => void;
  form: Pick<UseFormReturn<InvoiceFormValues>, "getValues" | "reset">;
  selectedFile: File | null;
  storedPdf: StoredPdf;
  setStoredPdf: (pdf: StoredPdf) => void;
  setSubmitError: (message: string) => void;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function mapDraftToFormValues(draft: BillDraftDetail): InvoiceFormValues {
  return {
    accountNumber: draft.account_number_raw ?? "",
    statementId: draft.invoice_number ?? "",
    companyName: draft.vendor_name_raw ?? "",
    issueDate: draft.invoice_date ?? "",
    dueDate: draft.due_date ?? "",
    currentDue: String(draft.amount ?? ""),
    previousPayments: String(draft.prev_payments ?? ""),
    description: draft.description ?? "",
    notes: draft.processing_notes ?? "",
    propertyAddress: draft.property_address ?? "",
    accountStatus: draft.account_status ?? "",
    websiteName: draft.website_name ?? "",
    vendorAccountId: draft.vendor_account_picked ? (draft.vendor_account_id ?? "") : "",
  };
}

export function draftPayload(values: InvoiceDraftFormValues): BillDraftPayload {
  return {
    account_number_raw: values.accountNumber || null,
    invoice_number: values.statementId || null,
    vendor_name_raw: values.companyName || null,
    invoice_date: values.issueDate || null,
    due_date: values.dueDate || null,
    amount: values.currentDue || null,
    prev_payments: values.previousPayments || null,
    description: values.description || null,
    processing_notes: values.notes || null,
    property_address: values.propertyAddress || null,
    account_status: values.accountStatus || null,
    website_name: values.websiteName || null,
    vendor_account_id: values.vendorAccountId || null,
  };
}

export function useInvoiceDraft({
  initialDraftId,
  onDraftCreated,
  form,
  selectedFile,
  storedPdf,
  setStoredPdf,
  setSubmitError,
}: UseInvoiceDraftOptions) {
  const { getValues, reset } = form;

  const [draftId, setDraftId] = useState(initialDraftId);
  const [draftStatus, setDraftStatus] = useState<DraftActionStatus>("idle");
  const [draftMessage, setDraftMessage] = useState("");
  const [isLoadingDraft, setIsLoadingDraft] = useState(initialDraftId !== null);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);

  const draftLoaded = useRef(false);
  const onDraftCreatedRef = useRef(onDraftCreated);

  onDraftCreatedRef.current = onDraftCreated;

  useEffect(() => {
    if (initialDraftId === null || draftLoaded.current) return;

    const draftIdToLoad = initialDraftId;
    let cancelled = false;

    async function loadDraft() {
      setIsLoadingDraft(true);
      setDraftLoadError(null);

      try {
        const draft = await getBillDraft(draftIdToLoad);

        if (cancelled) return;

        draftLoaded.current = true;
        reset(mapDraftToFormValues(draft));

        if (draft.document_path) {
          setStoredPdf({ kind: "earlier" });
        }
      } catch (error) {
        if (cancelled) return;

        setDraftLoadError(errorMessage(error, "Unable to load the draft. Please try again."));
      } finally {
        if (!cancelled) {
          setIsLoadingDraft(false);
        }
      }
    }

    void loadDraft();

    return () => {
      cancelled = true;
    };
  }, [initialDraftId, reset, setStoredPdf]);

  async function ensureDraftSaved(payload: BillDraftPayload): Promise<string> {
    if (draftId) {
      await updateBillDraft(draftId, payload);
      return draftId;
    }

    const saved = await saveBillDraft(payload);

    // The form already holds this draft. Don't refetch it when its ID
    // shows up in the URL.
    draftLoaded.current = true;

    setDraftId(saved.bill_id);
    onDraftCreatedRef.current(saved.bill_id);

    return saved.bill_id;
  }

  async function storePickedPdf(id: string): Promise<void> {
    const file = selectedFile;

    if (!file || (storedPdf.kind === "file" && storedPdf.file === file)) {
      return;
    }

    await uploadInvoicePdf(file, id);
    setStoredPdf({ kind: "file", file });
  }

  function markUnsaved() {
    setDraftStatus("idle");
    setDraftMessage("");
  }

  function clearDraftMessage() {
    setDraftMessage("");
  }

  async function handleSaveDraft(canSaveDraft: boolean): Promise<void> {
    if (!canSaveDraft) return;

    setDraftStatus("loading");
    setSubmitError("");
    setDraftMessage("");

    const validation = invoiceDraftFormSchema.safeParse(getValues());

    if (!validation.success) {
      setDraftStatus("error");
      setSubmitError(validation.error.issues[0]?.message ?? "Please check your draft.");
      return;
    }

    let id: string;

    try {
      id = await ensureDraftSaved(draftPayload(validation.data));
    } catch (error) {
      setDraftStatus("error");
      setSubmitError(errorMessage(error, "Unable to save draft."));
      return;
    }

    try {
      await storePickedPdf(id);
    } catch (error) {
      setDraftStatus("error");
      setSubmitError(
        `Draft saved, but the PDF couldn't be stored. Save again to retry.\n${errorMessage(error, "")}`.trim(),
      );
      return;
    }

    setDraftStatus("success");
    setDraftMessage(`Draft saved successfully: ${id}`);
  }

  return {
    draftId,
    draftStatus,
    draftMessage,
    isLoadingDraft,
    draftLoadError,
    ensureDraftSaved,
    storePickedPdf,
    handleSaveDraft,
    markUnsaved,
    clearDraftMessage,
  };
}

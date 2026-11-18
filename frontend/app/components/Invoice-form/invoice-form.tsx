"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileCheck, FileUp, LoaderCircle } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { type DragEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";

import { type StoredPdf, useInvoiceDraft } from "@/hooks/invoices/useInvoiceDraft";
import { useInvoiceExtraction } from "@/hooks/invoices/useInvoiceExtraction";
import { createBillPayload, useInvoiceSubmission } from "@/hooks/invoices/useInvoiceSubmission";

import { getBill, resubmitBill } from "@/lib/api/bills";
import type { ExtractionBanner } from "@/lib/extraction";
import {
  accountStatuses,
  emptyInvoiceForm,
  type InvoiceFormValues,
  invoiceFormSchema,
} from "@/lib/invoice-form-schema";
import type { Bill } from "@/types/bill";

import { VendorAccountField } from "./vendor-account-field";

type ActionStatus = "idle" | "loading" | "success" | "error";

const bannerTones: Record<ExtractionBanner["tone"], string> = {
  success: "border-paid/30 bg-paid-bg text-paid",
  warning: "border-due-soon/30 bg-due-soon-bg text-due-soon",
  error: "border-overdue/30 bg-overdue-bg text-overdue",
};

function ExtractionNotice({ banner }: { banner: ExtractionBanner }) {
  return (
    <div
      role={banner.tone === "error" ? "alert" : "status"}
      className={`mt-4 rounded-lg border p-3 text-left text-sm ${bannerTones[banner.tone]}`}
    >
      <p>{banner.message}</p>

      {banner.details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {banner.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function pdfStorageNote(
  stored: StoredPdf,
  picked: File | null,
): { tone: "stored" | "pending"; message: string } | null {
  if (picked && !(stored.kind === "file" && stored.file === picked)) {
    const action = stored.kind === "none" ? "will be stored" : "will replace the stored PDF";

    return {
      tone: "pending",
      message: `${picked.name} ${action} when you save the draft or submit the invoice.`,
    };
  }

  if (stored.kind === "file") {
    return {
      tone: "stored",
      message: `Stored PDF: ${stored.file.name}`,
    };
  }

  if (stored.kind === "earlier") {
    return {
      tone: "stored",
      message: "An existing PDF is stored with this invoice.",
    };
  }

  return null;
}

type InvoiceFormProps = {
  isResubmission?: boolean;
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function mapBillToFormValues(bill: Bill): InvoiceFormValues {
  return {
    accountNumber: bill.account_number_raw ?? "",
    statementId: bill.invoice_number ?? "",
    companyName: bill.vendor_name_raw ?? "",
    issueDate: bill.invoice_date ?? "",
    dueDate: bill.due_date ?? "",
    currentDue: String(bill.amount ?? ""),
    previousPayments: String(bill.prev_payments ?? ""),
    description: bill.description ?? "",
    notes: bill.processing_notes ?? "",
    propertyAddress: bill.property_address ?? "",
    accountStatus: bill.account_status ?? "",
    websiteName: bill.website_name ?? "",
    vendorAccountId: bill.vendor_account_picked ? (bill.vendor_account_id ?? "") : "",
  };
}

const DRAFT_PATH = /^\/invoices\/([^/]+)\/edit\/?$/;

function draftPath(draftId: string): string {
  return `/invoices/${encodeURIComponent(draftId)}/edit`;
}

function draftIdFromPath(pathname: string): string | null {
  const match = DRAFT_PATH.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function InvoiceForm({ isResubmission = false }: InvoiceFormProps) {
  const pathname = usePathname();
  const [visit, setVisit] = useState(0);

  const shownPath = useRef(pathname);
  const ownPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    const lastPath = shownPath.current;
    shownPath.current = pathname;

    if (pathname === lastPath) return;

    if (pathname === ownPath.current) {
      ownPath.current = null;
      return;
    }

    setVisit((current) => current + 1);
  }, [pathname]);

  function showDraftUrl(draftId: string) {
    const path = draftPath(draftId);

    ownPath.current = path;
    window.history.replaceState(null, "", path);
  }

  return (
    <InvoiceFormVisit
      key={visit}
      initialDraftId={draftIdFromPath(pathname)}
      isResubmission={isResubmission}
      onDraftCreated={showDraftUrl}
    />
  );
}

type InvoiceFormVisitProps = {
  initialDraftId: string | null;
  onDraftCreated: (draftId: string) => void;
  isResubmission: boolean;
};

function InvoiceFormVisit({
  initialDraftId,
  isResubmission,
  onDraftCreated,
}: InvoiceFormVisitProps) {
  const router = useRouter();
  const params = useParams<{ invoiceId?: string }>();

  const routeInvoiceId = isResubmission ? (params.invoiceId ?? null) : null;

  const [openedId] = useState(isResubmission ? routeInvoiceId : initialDraftId);

  const [submitError, setSubmitError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [storedPdf, setStoredPdf] = useState<StoredPdf>({
    kind: "none",
  });
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [resubmitStatus, setResubmitStatus] = useState<ActionStatus>("idle");
  const [isLoadingResubmission, setIsLoadingResubmission] = useState(isResubmission);
  const [resubmissionError, setResubmissionError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    getFieldState,
    control,
    formState: { errors },
    reset,
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: emptyInvoiceForm,
  });

  // Vendor account selection belongs to the form.
  const pickVendorAccount = useCallback(
    (vendorAccountId: string) => {
      setValue("vendorAccountId", vendorAccountId);
    },
    [setValue],
  );

  const clearVendorAccountPick = useCallback(() => {
    pickVendorAccount("");
  }, [pickVendorAccount]);

  // Draft lifecycle is managed by useInvoiceDraft.
  // Resubmissions do not create or load drafts.
  const {
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
  } = useInvoiceDraft({
    initialDraftId: isResubmission ? null : initialDraftId,
    onDraftCreated,
    form: { getValues, reset },
    selectedFile,
    storedPdf,
    setStoredPdf,
    setSubmitError,
  });

  function markEdited() {
    setSubmitError("");
    markUnsaved();
  }

  // PDF extraction lifecycle is managed by useInvoiceExtraction.
  const { reader, notes, readInvoice, resetReader, clearFieldNote, readingMessage } =
    useInvoiceExtraction({
      form: { getValues, setValue, getFieldState },
      onEdited: markEdited,
      onAccountNumberChanged: clearVendorAccountPick,
    });

  // Normal bill creation and submission are managed by useInvoiceSubmission.
  const { createStatus, handleCreate } = useInvoiceSubmission({
    selectedFile,
    ensureDraftSaved,
    storePickedPdf,
    onSuccess: () => router.push("/dashboard"),
    setSubmitError,
  });

  // Rejected invoice loading is separate from draft loading.
  useEffect(() => {
    if (!isResubmission) return;

    if (!openedId) {
      setResubmissionError("Missing invoice ID. Unable to load the invoice.");
      setIsLoadingResubmission(false);
      return;
    }

    let cancelled = false;

    async function loadRejectedInvoice() {
      setIsLoadingResubmission(true);
      setResubmissionError(null);

      try {
        const bill = await getBill(openedId);

        if (cancelled) return;

        if (bill.status !== "rejected") {
          setResubmissionError("Only rejected invoices can be resubmitted.");
          return;
        }

        reset(mapBillToFormValues(bill));

        if (bill.document_path) {
          setStoredPdf({ kind: "earlier" });
        }
      } catch (error) {
        if (cancelled) return;

        setResubmissionError(
          error instanceof Error ? error.message : "Unable to load the invoice. Please try again.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingResubmission(false);
        }
      }
    }

    void loadRejectedInvoice();

    return () => {
      cancelled = true;
    };
  }, [openedId, isResubmission, reset]);

  const watchedValues = useWatch({ control });

  const hasAnyInput =
    selectedFile !== null ||
    Object.values(watchedValues).some((value) => typeof value === "string" && value.trim() !== "");

  const saving = draftStatus === "loading" || createStatus === "loading";

  const canSaveDraft = hasAnyInput && !saving && createStatus !== "success";

  async function handleFormSubmit(values: InvoiceFormValues) {
    if (!isResubmission) {
      clearDraftMessage();
      await handleCreate(values);
      return;
    }

    if (!routeInvoiceId) {
      setResubmitStatus("error");
      setSubmitError("Missing invoice ID. Unable to resubmit.");
      return;
    }

    setResubmitStatus("loading");
    setSubmitError("");

    try {
      await resubmitBill(routeInvoiceId, createBillPayload(values));

      setResubmitStatus("success");
      router.push("/dashboard");
    } catch (error) {
      setResubmitStatus("error");
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Unable to resubmit the invoice. Please try again.",
      );
    }
  }

  function selectFile(file: File | null) {
    if (file && !isPdf(file)) {
      setSelectedFile(null);
      resetReader({ phase: "idle" });
      setFileError("Only PDF files can be uploaded.");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      return;
    }

    setSelectedFile(file);
    setFileError("");

    if (file) {
      markEdited();
      void readInvoice(file);
    } else {
      resetReader({ phase: "idle" });
      markEdited();
    }
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;

    if (files.length > 1) {
      setSelectedFile(null);
      resetReader({ phase: "idle" });
      setFileError("Drop one PDF at a time.");
      markEdited();

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    selectFile(files[0] ?? null);
  }

  const storageNote = pdfStorageNote(storedPdf, selectedFile);

  const isSubmittingResubmission = resubmitStatus === "loading";

  const actionStatus = isResubmission ? resubmitStatus : createStatus;

  const created = actionStatus === "success";

  if (isLoadingDraft || isLoadingResubmission) {
    return (
      <p className="mx-auto max-w-3xl py-16 text-center text-foreground-muted">
        {isResubmission ? "Loading rejected invoice..." : "Loading draft..."}
      </p>
    );
  }

  if (draftLoadError || resubmissionError) {
    return (
      <p role="alert" className="mx-auto max-w-3xl py-16 text-center text-red-600">
        {resubmissionError ?? draftLoadError}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      onChange={(event) => {
        const target = event.target;

        if (target instanceof HTMLInputElement && target.type === "file") {
          return;
        }

        markEdited();

        const name = "name" in target ? target.name : null;

        if (name === "accountNumber") {
          clearVendorAccountPick();
        }

        if (typeof name === "string") {
          clearFieldNote(name);
        }
      }}
      noValidate
      className="mx-auto max-w-3xl space-y-6"
    >
      {submitError && (
        <p
          role="alert"
          className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {submitError}
        </p>
      )}

      {draftMessage && (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800"
        >
          {draftMessage}
        </p>
      )}

      {isResubmission && (
        <p role="status" className="text-sm text-foreground-muted">
          {storedPdf.kind === "earlier"
            ? "The existing invoice PDF will be retained when you resubmit this invoice."
            : "No invoice PDF is currently stored with this invoice."}
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {isResubmission ? "Resubmit Rejected Invoice" : draftId ? "Edit Draft" : "New Invoice"}
        </h1>

        <div className="flex items-center gap-3">
          {!isResubmission && (
            <Button
              label={
                draftStatus === "loading"
                  ? "Saving..."
                  : draftStatus === "success"
                    ? "Draft Saved ✓"
                    : draftStatus === "error"
                      ? "Retry Save"
                      : "Save Draft"
              }
              type="button"
              onClick={() => handleSaveDraft(canSaveDraft)}
              disabled={!canSaveDraft}
            />
          )}

          <Button
            label="Cancel"
            variant="secondary"
            onClick={() => router.push("/dashboard")}
            type="button"
          />
        </div>
      </div>

      {!isResubmission && (
        <section
          aria-label="Invoice PDF"
          className="rounded-xl border border-border bg-surface p-6 text-center"
        >
          <label
            htmlFor="invoicePdf"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`block cursor-pointer rounded-lg border-2 border-dashed p-6 transition-colors focus-within:ring-2 focus-within:ring-ring ${
              isDragging ? "border-blue-600 bg-blue-50" : "border-border hover:bg-surface-muted"
            }`}
          >
            <FileUp className="mx-auto h-6 w-6 text-foreground-muted" />

            <span className="mt-2 block text-sm font-medium">
              {isDragging ? "Drop the PDF here" : "Upload / import invoice (PDF)"}
            </span>

            <span className="mt-1 block text-sm text-foreground-muted">
              {selectedFile
                ? selectedFile.name
                : storedPdf.kind !== "none"
                  ? "A PDF is already stored. Select a new PDF to replace it."
                  : "Drag and drop a PDF here, or click to browse"}
            </span>

            <input
              ref={fileInputRef}
              id="invoicePdf"
              type="file"
              accept=".pdf,application/pdf"
              className="sr-only"
              onChange={(event) => {
                selectFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>

          {reader.phase === "reading" && (
            <p
              role="status"
              className="mt-3 flex items-center justify-center gap-2 text-sm text-foreground-muted"
            >
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
              />
              {readingMessage}
            </p>
          )}

          {reader.phase === "done" && <ExtractionNotice banner={reader.banner} />}

          {storageNote?.tone === "stored" && (
            <p
              role="status"
              className="mt-3 flex items-center justify-center gap-2 text-sm text-paid"
            >
              <FileCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
              {storageNote.message}
            </p>
          )}

          {storageNote?.tone === "pending" && (
            <p className="mt-3 text-sm text-foreground-muted">{storageNote.message}</p>
          )}

          {fileError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {fileError}
            </p>
          )}
        </section>
      )}

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-2 text-sm font-semibold text-foreground">General bill info</legend>

        <FormField
          label="Account / Customer #"
          htmlFor="accountNumber"
          error={errors.accountNumber?.message}
          note={notes.accountNumber}
        >
          {(field) => <input {...field} {...register("accountNumber")} className={inputClass} />}
        </FormField>

        <VendorAccountField
          accountNumber={watchedValues.accountNumber ?? ""}
          value={watchedValues.vendorAccountId ?? ""}
          onChange={pickVendorAccount}
        />

        <FormField
          label="Statement / Bill ID"
          htmlFor="statementId"
          error={errors.statementId?.message}
          note={notes.statementId}
        >
          {(field) => <input {...field} {...register("statementId")} className={inputClass} />}
        </FormField>

        <FormField
          label="Customer / Business Name"
          htmlFor="companyName"
          error={errors.companyName?.message}
          note={notes.companyName}
        >
          {(field) => <input {...field} {...register("companyName")} className={inputClass} />}
        </FormField>

        <FormField
          label="Property Address"
          htmlFor="propertyAddress"
          error={errors.propertyAddress?.message}
          note={notes.propertyAddress}
        >
          {(field) => (
            <input
              {...field}
              {...register("propertyAddress")}
              placeholder="Enter property address"
              className={inputClass}
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Issue / Record / Invoice Date"
            htmlFor="issueDate"
            error={errors.issueDate?.message}
            note={notes.issueDate}
          >
            {(field) => (
              <input {...field} type="date" {...register("issueDate")} className={inputClass} />
            )}
          </FormField>

          <FormField
            label="Due / Pay Date"
            htmlFor="dueDate"
            error={errors.dueDate?.message}
            note={notes.dueDate}
          >
            {(field) => (
              <input {...field} type="date" {...register("dueDate")} className={inputClass} />
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-2 text-sm font-semibold text-foreground">Payment info</legend>

        <FormField
          label="Bill Description / Explanation"
          htmlFor="description"
          error={errors.description?.message}
          note={notes.description}
        >
          {(field) => (
            <input
              {...field}
              {...register("description")}
              placeholder="e.g. Utility, rent"
              className={inputClass}
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Prev Payments"
            htmlFor="previousPayments"
            error={errors.previousPayments?.message}
            note={notes.previousPayments}
          >
            {(field) => (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">
                  $
                </span>

                <input
                  {...field}
                  {...register("previousPayments")}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${inputClass} pl-7 tabular-nums`}
                />
              </div>
            )}
          </FormField>

          <FormField
            label="Current Due"
            htmlFor="currentDue"
            error={errors.currentDue?.message}
            note={notes.currentDue}
          >
            {(field) => (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">
                  $
                </span>

                <input
                  {...field}
                  {...register("currentDue")}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${inputClass} pl-7 tabular-nums`}
                />
              </div>
            )}
          </FormField>
        </div>

        <FormField
          label="Account Status"
          htmlFor="accountStatus"
          error={errors.accountStatus?.message}
          note={notes.accountStatus}
        >
          {(field) => (
            <select
              {...field}
              {...register("accountStatus")}
              className={`${inputClass} capitalize`}
            >
              {accountStatuses.map((status) => (
                <option key={status} value={status}>
                  {status || "Select status"}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          label="Payment / Processing Notes (optional)"
          htmlFor="notes"
          error={errors.notes?.message}
        >
          {(field) => (
            <textarea {...field} {...register("notes")} rows={4} className={inputClass} />
          )}
        </FormField>

        <FormField
          label="Website Name (optional)"
          htmlFor="websiteName"
          error={errors.websiteName?.message}
          note={notes.websiteName}
        >
          {(field) => (
            <input
              {...field}
              {...register("websiteName")}
              placeholder="https://domainname.com"
              className={inputClass}
            />
          )}
        </FormField>
      </fieldset>

      <Button
        label={
          actionStatus === "loading"
            ? isResubmission
              ? "Resubmitting..."
              : "Creating..."
            : actionStatus === "success"
              ? isResubmission
                ? "Resubmitted ✓"
                : "Created ✓"
              : actionStatus === "error"
                ? isResubmission
                  ? "Retry Resubmit"
                  : "Retry Create"
                : isResubmission
                  ? "Resubmit Invoice"
                  : "Create"
        }
        type="submit"
        disabled={saving || isSubmittingResubmission || created}
        className="w-full border-2"
      />
    </form>
  );
}

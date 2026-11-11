"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import {
  createBill,
  getBillDraft,
  saveBillDraft,
  updateBillDraft,
  uploadInvoicePdf,
} from "@/lib/api/bills";
import {
  accountStatuses,
  emptyInvoiceForm,
  type InvoiceFormValues,
  invoiceDraftFormSchema,
  invoiceFormSchema,
} from "@/lib/invoice-form-schema";
import type { BillCreatePayload, BillDraftDetail, BillDraftPayload } from "@/types/bill";

type ActionStatus = "idle" | "loading" | "success" | "error";

// Browsers sometimes report an empty MIME type for dropped files, so the
// extension is checked as well.
function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function mapDraftToFormValues(draft: BillDraftDetail): InvoiceFormValues {
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
  };
}

export function InvoiceForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [pdfStatus, setPdfStatus] = useState<ActionStatus>("idle");
  const [draftStatus, setDraftStatus] = useState<ActionStatus>("idle");
  const params = useParams<{ invoiceId: string }>();
  const routeInvoiceId = params.invoiceId;
  const [draftId, setDraftId] = useState<string | null>(params.invoiceId ?? null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(Boolean(params.invoiceId));
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);

  const [createStatus, setCreateStatus] = useState<ActionStatus>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    getValues,
    control,
    formState: { errors },
    reset,
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: emptyInvoiceForm,
  });

  const watchedValues = useWatch({ control });

  const hasAnyInput = Object.values(watchedValues).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );

  const canSaveDraft = hasAnyInput && draftStatus !== "loading";

  async function onSubmit(values: InvoiceFormValues) {
    setCreateStatus("loading");
    setSubmitError("");

    const payload: BillCreatePayload = {
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
    };

    try {
      await createBill(payload);

      setCreateStatus("success");
      router.push("/dashboard");
    } catch (err) {
      setCreateStatus("error");
      setSubmitError(
        err instanceof Error ? err.message : "Unable to create the bill. Please try again.",
      );
    }
  }

  useEffect(() => {
    if (!routeInvoiceId) {
      setIsLoadingDraft(false);
      return;
    }

    let cancelled = false;

    async function loadDraft() {
      setIsLoadingDraft(true);
      setDraftLoadError(null);

      try {
        const draft = await getBillDraft(routeInvoiceId);

        if (cancelled) return;

        reset(mapDraftToFormValues(draft));
      } catch (err) {
        if (cancelled) return;

        setDraftLoadError(
          err instanceof Error ? err.message : "Unable to load the draft. Please try again.",
        );
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
  }, [routeInvoiceId, reset]);

  // Shared by the file picker and drag-and-drop: a new file always resets
  // validation so a previous success never carries over to it.
  function selectFile(file: File | null) {
    setPdfStatus("idle");
    setUploadMessage("");

    if (file && !isPdf(file)) {
      setSelectedFile(null);
      setUploadError("Only PDF files can be uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setUploadError("");
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    // dragleave also fires when moving onto a child element; ignore those.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (files.length > 1) {
      setSelectedFile(null);
      setPdfStatus("idle");
      setUploadMessage("");
      setUploadError("Drop one PDF at a time.");
      return;
    }

    // The input keeps no record of dropped files; clear it so picking the
    // same file again later still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    selectFile(files[0] ?? null);
  }

  async function handleUploadPdf() {
    if (!selectedFile || !draftId) return;

    setPdfStatus("loading");
    setUploadError("");
    setUploadMessage("");

    try {
      const result = await uploadInvoicePdf(selectedFile, draftId);

      setPdfStatus("success");
      setUploadMessage(`PDF saved successfully: ${result.document_path}`);
    } catch (error) {
      setPdfStatus("error");
      setUploadError(error instanceof Error ? error.message : "Unable to upload PDF.");
    }
  }

  async function handleSaveDraft() {
    if (!hasAnyInput) return;
    setDraftStatus("loading");
    setSubmitError("");
    setDraftMessage("");

    try {
      const values = getValues();

      const validation = invoiceDraftFormSchema.safeParse(values);

      if (!validation.success) {
        setDraftStatus("error");
        setSubmitError(validation.error.issues[0]?.message ?? "Please check your draft.");
        return;
      }

      const draftValues = validation.data;

      // Blank fields are sent as null so that clearing a field on an
      // existing draft clears it in the database too.
      const payload: BillDraftPayload = {
        account_number_raw: draftValues.accountNumber || null,
        invoice_number: draftValues.statementId || null,
        vendor_name_raw: draftValues.companyName || null,
        invoice_date: draftValues.issueDate || null,
        due_date: draftValues.dueDate || null,
        amount: draftValues.currentDue || null,
        prev_payments: draftValues.previousPayments || null,
        description: draftValues.description || null,
        processing_notes: draftValues.notes || null,
        property_address: draftValues.propertyAddress || null,
        account_status: draftValues.accountStatus || null,
        website_name: draftValues.websiteName || null,
      };

      // The first save creates the draft; later saves update the same bill.
      const saved = draftId
        ? await updateBillDraft(draftId, payload)
        : await saveBillDraft(payload);

      if (!draftId) {
        setDraftId(saved.bill_id);

        window.history.replaceState(null, "", `/invoices/${saved.bill_id}/edit`);
      }

      setDraftStatus("success");
      setDraftMessage(`Draft saved successfully: ${saved.bill_id}`);
    } catch (error) {
      setDraftStatus("error");
      setSubmitError(error instanceof Error ? error.message : "Unable to save draft.");
    }
  }

  if (isLoadingDraft) {
    return (
      <p className="mx-auto max-w-3xl py-16 text-center text-foreground-muted">Loading draft...</p>
    );
  }

  if (draftLoadError) {
    return (
      <p role="alert" className="mx-auto max-w-3xl py-16 text-center text-red-600">
        {draftLoadError}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onChange={(event) => {
        // Editing a field after a save means there are unsaved changes.
        // Choosing a PDF is not a draft edit, so the file input is ignored.
        const target = event.target;
        if (target instanceof HTMLInputElement && target.type === "file") return;
        setSubmitError("");
        if (draftStatus === "success") {
          setDraftStatus("idle");
          setDraftMessage("");
        }
      }}
      noValidate
      className="mx-auto max-w-3xl space-y-6"
    >
      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {draftId ? "Edit Draft" : "New Invoice"}
        </h1>

        <div className="flex items-center gap-3">
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
            onClick={handleSaveDraft}
            disabled={!canSaveDraft}
          />
          <Button
            label="Cancel"
            variant="secondary"
            onClick={() => router.push("/dashboard")}
            type="button"
          />
        </div>
      </div>

      <section className="rounded-xl border border-border bg-surface p-6 text-center">
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
            {selectedFile ? selectedFile.name : "Drag and drop a PDF here, or click to browse"}
          </span>

          <input
            ref={fileInputRef}
            id="invoicePdf"
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="button"
          onClick={handleUploadPdf}
          disabled={!selectedFile || !draftId || pdfStatus === "loading" || pdfStatus === "success"}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {pdfStatus === "loading"
            ? "Uploading..."
            : pdfStatus === "success"
              ? "PDF Saved ✓"
              : pdfStatus === "error"
                ? "Retry Upload"
                : !draftId
                  ? "Save Draft First"
                  : "Upload PDF"}
        </button>

        {uploadMessage && (
          <p role="status" className="mt-3 text-sm text-green-700">
            {uploadMessage}
          </p>
        )}

        {uploadError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {uploadError}
          </p>
        )}
      </section>

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-2 text-sm font-semibold text-foreground">General bill info</legend>

        <FormField
          label="Account / Customer #"
          htmlFor="accountNumber"
          error={errors.accountNumber?.message}
        >
          {(field) => <input {...field} {...register("accountNumber")} className={inputClass} />}
        </FormField>

        <FormField
          label="Statement / Bill ID"
          htmlFor="statementId"
          error={errors.statementId?.message}
        >
          {(field) => <input {...field} {...register("statementId")} className={inputClass} />}
        </FormField>

        <FormField
          label="Customer / Business Name"
          htmlFor="companyName"
          error={errors.companyName?.message}
        >
          {(field) => <input {...field} {...register("companyName")} className={inputClass} />}
        </FormField>

        <FormField
          label="Property Address"
          htmlFor="propertyAddress"
          error={errors.propertyAddress?.message}
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
          >
            {(field) => (
              <input {...field} type="date" {...register("issueDate")} className={inputClass} />
            )}
          </FormField>

          <FormField label="Due / Pay Date" htmlFor="dueDate" error={errors.dueDate?.message}>
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

          <FormField label="Current Due" htmlFor="currentDue" error={errors.currentDue?.message}>
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
          createStatus === "loading"
            ? "Creating..."
            : createStatus === "success"
              ? "Created ✓"
              : createStatus === "error"
                ? "Retry Create"
                : "Create"
        }
        type="submit"
        disabled={createStatus === "loading" || createStatus === "success"}
        className="w-full border-2"
      />
    </form>
  );
}

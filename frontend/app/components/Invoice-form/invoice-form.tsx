"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp, LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type DragEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import {
  createBill,
  extractBill,
  getBillDraft,
  saveBillDraft,
  updateBillDraft,
  uploadInvoicePdf,
} from "@/lib/api/bills";
import {
  clearedValues,
  type ExtractedFormField,
  type ExtractionBanner,
  errorBanner,
  type FieldValues,
  planFill,
  READING_MESSAGE,
} from "@/lib/extraction";
import {
  accountStatuses,
  emptyInvoiceForm,
  type InvoiceFormValues,
  invoiceDraftFormSchema,
  invoiceFormSchema,
} from "@/lib/invoice-form-schema";
import type { BillCreatePayload, BillDraftDetail, BillDraftPayload } from "@/types/bill";

type ActionStatus = "idle" | "loading" | "success" | "error";

// Reading the picked PDF with POST /bills/extract.
type ReaderState =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "done"; banner: ExtractionBanner };

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

const DRAFT_PATH = /^\/invoices\/([^/]+)\/edit\/?$/;

// Where a saved draft is edited. The first Save Draft on a new invoice moves
// the address bar here without leaving the page.
function draftPath(draftId: string): string {
  return `/invoices/${encodeURIComponent(draftId)}/edit`;
}

// The draft a pathname opens, or null for a new invoice.
function draftIdFromPath(pathname: string): string | null {
  const match = DRAFT_PATH.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

// The New Invoice and Edit Draft pages. Next keeps a page mounted (hidden by
// <Activity>) after the person leaves it, so the form state outlives the
// visit unless it is reset. Each visit gets its own InvoiceFormVisit:
// - A link or router.push/replace into the page gives the segment a new
//   bfcacheId, so it starts fresh. Back and forward keep the bfcacheId, so the
//   form comes back as the person left it.
// - The first Save Draft moves the URL with history.replaceState. Next syncs
//   usePathname with that, but its route tree (and useParams) still say
//   /invoices/new, so a later link to /invoices/new reuses this segment and
//   its bfcacheId. A pathname change the form did not make is therefore a new
//   visit too. Layout effects only run while the page is shown, so the
//   pathnames of other pages, seen while hidden, never count.
export function InvoiceForm() {
  const { bfcacheId } = useRouter();
  const pathname = usePathname();
  const [visit, setVisit] = useState(0);
  const shown = useRef({ bfcacheId, pathname });
  // The URL the form itself moved to, until Next reports it back.
  const ownPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    const last = shown.current;
    shown.current = { bfcacheId, pathname };
    // A new bfcacheId already remounted the form for the current URL.
    if (pathname === last.pathname || bfcacheId !== last.bfcacheId) return;
    if (pathname === ownPath.current) {
      ownPath.current = null;
      return;
    }
    setVisit((current) => current + 1);
  }, [bfcacheId, pathname]);

  function showDraftUrl(draftId: string) {
    const path = draftPath(draftId);
    ownPath.current = path;
    window.history.replaceState(null, "", path);
  }

  return (
    <InvoiceFormVisit
      key={`${bfcacheId}:${visit}`}
      initialDraftId={draftIdFromPath(pathname)}
      onDraftCreated={showDraftUrl}
    />
  );
}

type InvoiceFormVisitProps = {
  // The draft this visit opens, loaded from the server; null for a new
  // invoice. Read once: a later change (the first save) does not reload.
  initialDraftId: string | null;
  // The first Save Draft created this draft.
  onDraftCreated: (draftId: string) => void;
};

function InvoiceFormVisit({ initialDraftId, onDraftCreated }: InvoiceFormVisitProps) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [pdfStatus, setPdfStatus] = useState<ActionStatus>("idle");
  const [draftStatus, setDraftStatus] = useState<ActionStatus>("idle");
  const [openedDraftId] = useState(initialDraftId);
  const [draftId, setDraftId] = useState(openedDraftId);
  const [isLoadingDraft, setIsLoadingDraft] = useState(openedDraftId !== null);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const draftLoaded = useRef(false);

  const [createStatus, setCreateStatus] = useState<ActionStatus>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reader, setReader] = useState<ReaderState>({ phase: "idle" });
  const [notes, setNotes] = useState<FieldValues>({});
  // The read in flight. Aborting it (a new file, or leaving the page) also
  // tells readInvoice to drop its result.
  const readRef = useRef<AbortController | null>(null);
  // The fields holding exactly what the last read filled, with that value.
  // The next read may replace them; editing a field takes it out.
  const readerFilled = useRef(new Map<ExtractedFormField, string>());

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

  // Effects run again each time the page is shown, so after back or forward
  // the draft is not reloaded over the person's unsaved edits.
  useEffect(() => {
    if (openedDraftId === null || draftLoaded.current) return;
    const id = openedDraftId;

    let cancelled = false;

    async function loadDraft() {
      setIsLoadingDraft(true);
      setDraftLoadError(null);

      try {
        const draft = await getBillDraft(id);

        if (cancelled) return;

        draftLoaded.current = true;
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
  }, [openedDraftId, reset]);

  // Leaving the page (or unmounting) stops a read in flight. Its result would
  // be dropped, so "Reading invoice..." must not be left showing for when the
  // person comes back.
  useEffect(
    () => () => {
      if (!readRef.current) return;
      readRef.current.abort();
      readRef.current = null;
      setReader({ phase: "idle" });
    },
    [],
  );

  // Any edit after a save means there are unsaved changes. Updaters, not the
  // rendered draftStatus, because a read can finish long after this render.
  function markEdited() {
    setSubmitError("");
    setDraftStatus((status) => (status === "success" ? "idle" : status));
    setDraftMessage("");
  }

  // Stops any read in flight and clears what the last one showed.
  function resetReader(next: ReaderState) {
    readRef.current?.abort();
    readRef.current = null;
    setNotes({});
    setReader(next);
  }

  // The fields still showing exactly what the last read filled. Checked
  // against the current value too, so nothing the person changed counts.
  function replaceableFields(): Set<ExtractedFormField> {
    const current = getValues();
    return new Set(
      [...readerFilled.current]
        .filter(([name, value]) => current[name] === value)
        .map(([name]) => name),
    );
  }

  function applyFill(values: Partial<Record<ExtractedFormField, string>>) {
    const entries = Object.entries(values) as [ExtractedFormField, string][];
    for (const [name, value] of entries) {
      // Re-validate only a field already showing an error, so a filled
      // value clears "required" without new errors appearing before Create.
      setValue(name, value, { shouldDirty: true, shouldValidate: getFieldState(name).invalid });
      if (value === "") readerFilled.current.delete(name);
      else readerFilled.current.set(name, value);
    }
    if (entries.length > 0) markEdited();
  }

  // Pre-fills the form from the PDF. A field is set only if it is empty when
  // the result arrives or still holds what the previous read filled, so
  // nothing the person typed or edited (even while it was reading), and
  // nothing loaded from a saved draft, is overwritten.
  async function readInvoice(file: File) {
    resetReader({ phase: "reading" });
    const controller = new AbortController();
    readRef.current = controller;

    let banner: ExtractionBanner;
    try {
      const result = await extractBill(file, controller.signal);
      if (controller.signal.aborted) return;

      const plan = planFill(result, getValues(), replaceableFields());
      applyFill(plan.values);
      setNotes(plan.notes);
      banner = plan.banner;
    } catch (error) {
      if (controller.signal.aborted) return;
      // The previous read's values came from the previous file.
      applyFill(clearedValues(replaceableFields()));
      banner = errorBanner(error instanceof Error ? error.message : "Unable to read the invoice.");
    }

    readRef.current = null;
    setReader({ phase: "done", banner });
  }

  // Shared by the file picker and drag-and-drop: a new file always resets
  // validation so a previous success never carries over to it.
  function selectFile(file: File | null) {
    setPdfStatus("idle");
    setUploadMessage("");

    if (file && !isPdf(file)) {
      setSelectedFile(null);
      resetReader({ phase: "idle" });
      setUploadError("Only PDF files can be uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setUploadError("");
    if (file) {
      void readInvoice(file);
    } else {
      resetReader({ phase: "idle" });
    }
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
      resetReader({ phase: "idle" });
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
    if (!selectedFile) return;

    setPdfStatus("loading");
    setUploadError("");
    setUploadMessage("");

    const id = draftId ?? (await persistDraft());

    if (!id) {
      setPdfStatus("idle");
      setUploadError("The draft couldn't be saved, so the PDF wasn't uploaded.");
      return;
    }

    try {
      const result = await uploadInvoicePdf(selectedFile, id);

      setPdfStatus("success");
      setUploadMessage(`PDF saved successfully: ${result.document_path}`);
    } catch (error) {
      setPdfStatus("error");
      setUploadError(error instanceof Error ? error.message : "Unable to upload PDF.");
    }
  }

  // Saves (or updates) the draft and returns its id, or null if it failed.
  async function persistDraft(): Promise<string | null> {
    setDraftStatus("loading");
    setSubmitError("");
    setDraftMessage("");

    try {
      const validation = invoiceDraftFormSchema.safeParse(getValues());

      if (!validation.success) {
        setDraftStatus("error");
        setSubmitError(validation.error.issues[0]?.message ?? "Please check your draft.");
        return null;
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
        onDraftCreated(saved.bill_id);
      }

      setDraftStatus("success");
      setDraftMessage(`Draft saved successfully: ${saved.bill_id}`);
      return saved.bill_id;
    } catch (error) {
      setDraftStatus("error");
      setSubmitError(error instanceof Error ? error.message : "Unable to save draft.");
      return null;
    }
  }

  async function handleSaveDraft() {
    if (!hasAnyInput) return;
    await persistDraft();
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
        markEdited();
        // Editing a field marked "Check this" settles it, and makes its
        // value the person's: no later read replaces it.
        const name = "name" in target ? target.name : null;
        if (typeof name === "string") {
          readerFilled.current.delete(name as ExtractedFormField);
          setNotes((current) =>
            name in current
              ? Object.fromEntries(Object.entries(current).filter(([field]) => field !== name))
              : current,
          );
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
            onChange={(event) => {
              selectFile(event.target.files?.[0] ?? null);
              // The picked file lives in state. Clearing the input lets the
              // same file be picked again (to retry a read), which browsers
              // otherwise ignore.
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
            {READING_MESSAGE}
          </p>
        )}

        {reader.phase === "done" && <ExtractionNotice banner={reader.banner} />}

        <button
          type="button"
          onClick={handleUploadPdf}
          disabled={!selectedFile || pdfStatus === "loading" || pdfStatus === "success"}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {pdfStatus === "loading"
            ? "Uploading..."
            : pdfStatus === "success"
              ? "PDF Saved ✓"
              : pdfStatus === "error"
                ? "Retry Upload"
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
          note={notes.accountNumber}
        >
          {(field) => <input {...field} {...register("accountNumber")} className={inputClass} />}
        </FormField>

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

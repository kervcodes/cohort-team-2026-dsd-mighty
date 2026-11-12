"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileCheck, FileUp, LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type DragEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import Button from "@/components/Button";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import {
  extractBill,
  getBillDraft,
  saveBillDraft,
  submitBill,
  updateBillDraft,
  uploadInvoicePdf,
} from "@/lib/api/bills";
import { ApiError } from "@/lib/api/http";
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
  type InvoiceDraftFormValues,
  type InvoiceFormValues,
  invoiceDraftFormSchema,
  invoiceFormSchema,
} from "@/lib/invoice-form-schema";
import type { BillCreatePayload, BillDraftDetail, BillDraftPayload } from "@/types/bill";

type ActionStatus = "idle" | "loading" | "success" | "error";

// The PDF stored with this visit's draft: none yet, one stored before this
// visit opened the draft (the server keeps only its storage path, not its
// name), or a file picked and stored during this visit.
type StoredPdf = { kind: "none" } | { kind: "earlier" } | { kind: "file"; file: File };

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

// What the line under the drop zone says about the bill's PDF: what is stored
// with the draft, or that the picked file is stored on the next save or
// Create. Null when there is nothing to say.
function pdfStorageNote(
  stored: StoredPdf,
  picked: File | null,
): { tone: "stored" | "pending"; message: string } | null {
  if (picked && !(stored.kind === "file" && stored.file === picked)) {
    const action = stored.kind === "none" ? "is stored" : "replaces the stored PDF";
    return {
      tone: "pending",
      message: `${picked.name} ${action} when you save the draft or create the bill.`,
    };
  }
  if (stored.kind === "file") {
    return { tone: "stored", message: `Stored with this draft: ${stored.file.name}` };
  }
  if (stored.kind === "earlier") {
    return { tone: "stored", message: "A PDF is stored with this draft." };
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
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

// Save Draft sends every field, blank ones as null, so that clearing a field
// on an existing draft clears it in the database too.
function draftPayload(values: InvoiceDraftFormValues): BillDraftPayload {
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
  };
}

// The final values Create submits, from a fully validated form.
function createPayload(values: InvoiceFormValues): BillCreatePayload {
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
  // The first Save Draft, or a Create with no draft yet, created this draft.
  onDraftCreated: (draftId: string) => void;
};

function InvoiceFormVisit({ initialDraftId, onDraftCreated }: InvoiceFormVisitProps) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [storedPdf, setStoredPdf] = useState<StoredPdf>({ kind: "none" });
  const [fileError, setFileError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
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

  const hasAnyInput =
    selectedFile !== null ||
    Object.values(watchedValues).some((value) => typeof value === "string" && value.trim() !== "");

  // Save Draft and Create both may create the draft, so one waits for the
  // other: running both at once could make two bills.
  const saving = draftStatus === "loading" || createStatus === "loading";
  const created = createStatus === "success";
  const canSaveDraft = hasAnyInput && !saving && !created;

  // Saves the values to the draft, creating it on the first save, and returns
  // its id. Throws if the save fails.
  async function saveDraftValues(payload: BillDraftPayload): Promise<string> {
    if (draftId) {
      await updateBillDraft(draftId, payload);
      return draftId;
    }
    const saved = await saveBillDraft(payload);
    setDraftId(saved.bill_id);
    onDraftCreated(saved.bill_id);
    return saved.bill_id;
  }

  // Stores the picked PDF with draft `id`, replacing the one stored before,
  // unless the picked file is already the stored one. Throws if it fails.
  async function storePickedPdf(id: string) {
    const file = selectedFile;
    if (!file || (storedPdf.kind === "file" && storedPdf.file === file)) return;
    await uploadInvoicePdf(file, id);
    setStoredPdf({ kind: "file", file });
  }

  // Create, after the full validation passed: the bill is the draft, so its
  // PDF goes with it. Each step is skipped once done, so a retry after a
  // failure continues with the same draft and never makes a second bill.
  async function onSubmit(values: InvoiceFormValues) {
    setCreateStatus("loading");
    setSubmitError("");
    setDraftMessage("");

    let id = draftId;
    try {
      id ??= await saveDraftValues(draftPayload(values));
    } catch (error) {
      setCreateStatus("error");
      setSubmitError(errorMessage(error, "Unable to create the bill. Please try again."));
      return;
    }

    try {
      await storePickedPdf(id);
    } catch (error) {
      setCreateStatus("error");
      setSubmitError(
        `The PDF couldn't be stored, so the bill wasn't created. Please try again.\n${errorMessage(error, "")}`.trim(),
      );
      return;
    }

    try {
      await submitBill(id, createPayload(values));
    } catch (error) {
      // 409 means this draft was already submitted: an earlier try reached
      // the server but its response was lost. The bill is with the approver,
      // so this try succeeded too. Only the caller's own bill can answer 409.
      if (!(error instanceof ApiError && error.status === 409)) {
        setCreateStatus("error");
        setSubmitError(errorMessage(error, "Unable to create the bill. Please try again."));
        return;
      }
    }

    setCreateStatus("success");
    router.push("/dashboard");
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
        if (draft.document_path) setStoredPdf({ kind: "earlier" });
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

  // Shared by the file picker and drag-and-drop. A new PDF is an unsaved
  // change: the next Save Draft or Create stores it with the bill.
  function selectFile(file: File | null) {
    if (file && !isPdf(file)) {
      setSelectedFile(null);
      resetReader({ phase: "idle" });
      setFileError("Only PDF files can be uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setFileError("");
    if (file) {
      markEdited();
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
      setFileError("Drop one PDF at a time.");
      return;
    }

    // The input keeps no record of dropped files; clear it so picking the
    // same file again later still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    selectFile(files[0] ?? null);
  }

  // Saves the values, then stores the picked PDF with the draft. A PDF that
  // fails to store leaves the draft saved; the next save retries it.
  async function handleSaveDraft() {
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
      id = await saveDraftValues(draftPayload(validation.data));
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

  const storageNote = pdfStorageNote(storedPdf, selectedFile);

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
        disabled={saving || created}
        className="w-full border-2"
      />
    </form>
  );
}

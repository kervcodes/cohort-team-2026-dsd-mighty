// Turns a POST /bills/extract result into what the invoice form shows: the
// values to pre-fill, a "Check this" note per field and a banner. Pure: the
// form decides when to apply the plan.

import {
  accountStatuses,
  type InvoiceFormValues,
  isMoney,
  isValidIsoDate,
  isWebsite,
} from "@/lib/invoice-form-schema";
import type {
  BillExtraction,
  ExtractionIssue,
  ExtractionResult,
  IssueCode,
} from "@/types/extraction";

export const READING_MESSAGE = "Reading invoice...";

type ValueKind = "text" | "date" | "amount" | "amountAboveZero" | "website" | "status";

// Extraction field -> form field, and how its value is checked.
const FIELD_MAP = [
  { from: "vendor_name", to: "companyName", kind: "text" },
  { from: "account_number", to: "accountNumber", kind: "text" },
  { from: "invoice_number", to: "statementId", kind: "text" },
  { from: "invoice_date", to: "issueDate", kind: "date" },
  { from: "due_date", to: "dueDate", kind: "date" },
  { from: "amount_due", to: "currentDue", kind: "amountAboveZero" },
  { from: "payments_received", to: "previousPayments", kind: "amount" },
  { from: "service_address", to: "propertyAddress", kind: "text" },
  { from: "description", to: "description", kind: "text" },
  { from: "payment_website", to: "websiteName", kind: "website" },
  { from: "account_status", to: "accountStatus", kind: "status" },
] as const satisfies readonly {
  from: keyof BillExtraction;
  to: keyof InvoiceFormValues;
  kind: ValueKind;
}[];

export type ExtractedFormField = (typeof FIELD_MAP)[number]["to"];

export type FieldValues = Partial<Record<ExtractedFormField, string>>;

export type ExtractionBanner = {
  tone: "success" | "warning" | "error";
  message: string;
  details: string[];
};

export type FillPlan = {
  // What to set: a usable value for a field that was empty or replaceable,
  // and "" for a replaceable field this read has no usable value for.
  values: FieldValues;
  notes: FieldValues;
  banner: ExtractionBanner;
};

const MAPPED_FIELDS = new Set<string>(FIELD_MAP.map((field) => field.from));
const MAX_DETAILS = 5;
// The statuses the Account Status select offers, without "Select status".
const STATUSES = new Set<string>(accountStatuses.filter((status) => status !== ""));

type Normalized = { ok: true; value: string } | { ok: false; problem: string } | null;

// "$1,234.56", "1 234.56" and "1234.56" all become "1234.56". Commas must
// group thousands ("1,18" is not 118).
function normalizeAmount(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "");
  if (!/^\$?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(compact)) return null;
  const amount = compact.replace(/[$,]/g, "");
  return isMoney(amount) ? amount : null;
}

// null when the bill has no value, so there is nothing to fill or report.
export function normalizeValue(kind: ValueKind, raw: string | null): Normalized {
  const value = raw?.trim() ?? "";
  if (value === "") return null;

  switch (kind) {
    case "text":
      return { ok: true, value };
    case "date":
      return isValidIsoDate(value)
        ? { ok: true, value }
        : { ok: false, problem: `read "${value}", which isn't a valid date` };
    case "amount":
    case "amountAboveZero": {
      const amount = normalizeAmount(value);
      if (amount === null) {
        return { ok: false, problem: `read "${value}", which isn't a valid amount` };
      }
      if (kind === "amountAboveZero" && Number(amount) <= 0) {
        return { ok: false, problem: `read "${value}", but the amount must be more than 0` };
      }
      return { ok: true, value: amount };
    }
    case "website":
      return isWebsite(value)
        ? { ok: true, value }
        : { ok: false, problem: `read "${value}", which isn't a valid web address` };
    case "status":
      return STATUSES.has(value)
        ? { ok: true, value }
        : { ok: false, problem: `read "${value}", which isn't paid, unpaid or outstanding` };
  }
}

// Issue messages from the backend name schema fields ("amount_due is
// missing"), so each code gets wording a reviewer understands. An unknown
// code falls back to the backend message.
const ISSUE_REASONS: Record<IssueCode, string> = {
  MISSING_REQUIRED: "not found on the bill",
  BAD_DATE: "not a valid date",
  DUE_BEFORE_INVOICE: "the due date is before the invoice date",
  DATE_OUT_OF_RANGE: "more than a year ago or over 6 months ahead",
  BAD_AMOUNT: "not a valid amount",
  BAD_URL: "not a valid web address",
  LINE_ITEMS_MISMATCH: "the line items don't add up to it",
  BALANCE_MISMATCH: "the balance, payments and charges on the bill don't add up to it",
  EVIDENCE_NOT_FOUND: "couldn't find it in the PDF's text",
  EVIDENCE_MISMATCH: "doesn't match the text it was read from",
  LOW_CONFIDENCE: "the reader wasn't sure",
  MODELS_DISAGREE: "two reads of the bill gave different values",
};

export function issueReason(issue: ExtractionIssue): string {
  if (issue.code === "LINE_ITEMS_MISMATCH" && issue.field.startsWith("line_items[")) {
    return "no usable amount";
  }
  return ISSUE_REASONS[issue.code] ?? issue.message;
}

// "line_items[0].amount" -> "Line item 1 amount", "current_charges" -> "Current charges".
export function fieldLabel(field: string): string {
  const label = field
    .replace(/line_items\[(\d+)\]\.?/g, (_, index: string) => `line item ${Number(index) + 1} `)
    .replace(/_/g, " ")
    .trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function checkThis(reasons: string[]): string | undefined {
  return reasons.length > 0 ? `Check this: ${unique(reasons).join("; ")}` : undefined;
}

function fieldCount(count: number): string {
  return count === 1 ? "1 field" : `${count} fields`;
}

function summarize(lines: string[]): string[] {
  const all = unique(lines);
  if (all.length <= MAX_DETAILS) return all;
  return [...all.slice(0, MAX_DETAILS), `...and ${all.length - MAX_DETAILS} more`];
}

export function errorBanner(message: string): ExtractionBanner {
  return { tone: "error", message, details: [] };
}

// Clears the replaceable fields: what an earlier read filled belongs to that
// file, so a read that yields nothing for them takes it away.
export function clearedValues(replaceable: ReadonlySet<ExtractedFormField>): FieldValues {
  return Object.fromEntries([...replaceable].map((field) => [field, ""]));
}

// What to fill, given the form's values at the moment the result arrives.
// `replaceable` names the fields still holding exactly what an earlier read
// filled; the form drops a field from it as soon as the person edits it.
// Any other field that already has a value keeps it and gets no note: the
// person's value is not what the reader read, so the reader's doubts don't
// apply.
export function planFill(
  result: ExtractionResult,
  current: Record<ExtractedFormField, string>,
  replaceable: ReadonlySet<ExtractedFormField> = new Set(),
): FillPlan {
  if (result.status === "not_an_invoice") {
    return {
      values: clearedValues(replaceable),
      notes: {},
      banner: {
        tone: "warning",
        message: "This file doesn't look like a bill. Fill in the form yourself.",
        details: [],
      },
    };
  }

  const extraction = result.extraction;
  if (result.status === "failed" || extraction === null) {
    return {
      values: clearedValues(replaceable),
      notes: {},
      banner: {
        tone: "error",
        message: "Couldn't read this invoice. Fill in the form yourself.",
        details: result.failed_reason ? [result.failed_reason] : [],
      },
    };
  }

  const values: FieldValues = {};
  const notes: FieldValues = {};
  let filled = 0;
  let kept = 0;

  for (const { from, to, kind } of FIELD_MAP) {
    const replace = replaceable.has(to);
    if (current[to].trim() !== "" && !replace) {
      kept += 1;
      continue;
    }

    const read = extraction[from];
    const normalized = normalizeValue(kind, read.value);
    const issues = result.issues.filter((issue) => issue.field === from);
    let reasons = issues.map(issueReason);

    if (normalized?.ok) {
      values[to] = normalized.value;
      filled += 1;
      if (read.confidence === "low" && !issues.some((i) => i.code === "LOW_CONFIDENCE")) {
        reasons.push(ISSUE_REASONS.LOW_CONFIDENCE);
      }
    } else {
      if (replace) values[to] = "";
      if (normalized) {
        // Not filled: say what was read so the person can type it in.
        const restated = new Set([
          ISSUE_REASONS.BAD_DATE,
          ISSUE_REASONS.BAD_AMOUNT,
          ISSUE_REASONS.BAD_URL,
        ]);
        reasons = [normalized.problem, ...reasons.filter((reason) => !restated.has(reason))];
      }
    }

    const note = checkThis(reasons);
    if (note) notes[to] = note;
  }

  const otherIssues = summarize(
    result.issues
      .filter((issue) => !MAPPED_FIELDS.has(issue.field))
      .map((issue) => `${fieldLabel(issue.field)}: ${issueReason(issue)}`),
  );

  const hasNotes = Object.keys(notes).length > 0;
  // needs_attention whose only issues were on fields the person had already
  // filled leaves nothing to check, so it reads like ready_for_review.
  if (result.status === "ready_for_review" || (!hasNotes && otherIssues.length === 0)) {
    return {
      values,
      notes,
      banner: {
        tone: "success",
        message:
          filled > 0
            ? `Filled ${fieldCount(filled)} from the invoice. Check them before you create the bill.`
            : kept > 0
              ? "Nothing was filled because the fields already had values."
              : "Nothing on the invoice could be filled in. Fill in the form yourself.",
        details: otherIssues,
      },
    };
  }

  const filledSentence = filled > 0 ? `Filled ${fieldCount(filled)} from the invoice. ` : "";
  const where = hasNotes ? " - see the marked fields" : "";
  return {
    values,
    notes,
    banner: {
      tone: "warning",
      message: `${filledSentence}Some values need checking${where}.`,
      details: otherIssues,
    },
  };
}

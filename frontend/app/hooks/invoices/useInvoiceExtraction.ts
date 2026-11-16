"use client";

import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { extractBill } from "@/lib/api/bills";
import {
  clearedValues,
  type ExtractedFormField,
  type ExtractionBanner,
  errorBanner,
  type FieldValues,
  planFill,
  READING_MESSAGE,
} from "@/lib/extraction";
import type { InvoiceFormValues } from "@/lib/invoice-form-schema";

export type ReaderState =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "done"; banner: ExtractionBanner };

type ExtractionForm = Pick<
  UseFormReturn<InvoiceFormValues>,
  "getValues" | "setValue" | "getFieldState"
>;

type UseInvoiceExtractionOptions = {
  form: ExtractionForm;
  onEdited: () => void;
};

export function useInvoiceExtraction({ form, onEdited }: UseInvoiceExtractionOptions) {
  const { getValues, setValue, getFieldState } = form;

  const [reader, setReader] = useState<ReaderState>({ phase: "idle" });
  const [notes, setNotes] = useState<FieldValues>({});

  const readRef = useRef<AbortController | null>(null);
  const readerFilled = useRef(new Map<ExtractedFormField, string>());

  // Stop an in-flight extraction when the component unmounts.
  useEffect(() => {
    return () => {
      readRef.current?.abort();
      readRef.current = null;
    };
  }, []);

  function resetReader(next: ReaderState = { phase: "idle" }) {
    readRef.current?.abort();
    readRef.current = null;
    setNotes({});
    setReader(next);
  }

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
      setValue(name, value, {
        shouldDirty: true,
        shouldValidate: getFieldState(name).invalid,
      });

      if (value === "") {
        readerFilled.current.delete(name);
      } else {
        readerFilled.current.set(name, value);
      }
    }

    if (entries.length > 0) {
      onEdited();
    }
  }

  function clearFieldNote(name: string) {
    readerFilled.current.delete(name as ExtractedFormField);

    setNotes((current) =>
      name in current
        ? Object.fromEntries(Object.entries(current).filter(([field]) => field !== name))
        : current,
    );
  }

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

      applyFill(clearedValues(replaceableFields()));

      banner = errorBanner(error instanceof Error ? error.message : "Unable to read the invoice.");
    }

    if (controller.signal.aborted) return;

    readRef.current = null;
    setReader({ phase: "done", banner });
  }

  return {
    reader,
    notes,
    readInvoice,
    resetReader,
    clearFieldNote,
    readingMessage: READING_MESSAGE,
  };
}

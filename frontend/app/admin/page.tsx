"use client";

import { useState } from "react";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RuleField from "@/components/RuleField/RuleField";
import Button from "@/components/ui/button";
import { type RuleErrors, validateRules } from "@/lib/validation";

const COPY = {
  sectionTitle: "Approval Rules",
  invoiceMaximum: "Invoice Maximum",
  invoiceMaximumTooltip: "The largest invoice that does not need admin intervention.",
  minApprovals: "Minimum Approvals Needed",
  minApprovalsTooltip: "How many approvals an invoice needs before it is approved.",
  save: "Save",
  saved: "Rules saved.",
  confirmTitle: "Save approval rules?",
  confirmLabel: "Save changes",
  confirmIntro: "This changes how invoices get approved for your company:",
  summaryInvoiceMax: "Invoice maximum",
  summaryMinApprovals: "Minimum approvals",
  invoiceMaximumHint: "Numbers only, up to 2 decimal places (e.g. 5000.50).",
  minApprovalsHint: "Whole numbers only. Must be at least 1.",
};

export default function AdminPage() {
  const [form, setForm] = useState({
    invoice_maximum: "5000.00",
    min_approvals: "1",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<RuleErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const handleSaveClick = () => {
    setMessage(null);
    const found = validateRules(form);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      setConfirmOpen(true);
    }
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    setMessage(COPY.saved);
  };

  const invoiceSummary = `${COPY.summaryInvoiceMax}: $${form.invoice_maximum}`;
  const approvalsSummary = `${COPY.summaryMinApprovals}: ${form.min_approvals}`;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-6 inline-block rounded bg-surface-muted px-3 py-1 text-xl font-medium text-foreground">
          {COPY.sectionTitle}
        </h2>

        <RuleField
          label={COPY.invoiceMaximum}
          tooltip={COPY.invoiceMaximumTooltip}
          hint={COPY.invoiceMaximumHint}
          prefix="$"
          value={form.invoice_maximum}
          error={errors.invoice_maximum}
          onChange={(v) => setForm({ ...form, invoice_maximum: v })}
        />

        <RuleField
          label={COPY.minApprovals}
          tooltip={COPY.minApprovalsTooltip}
          hint={COPY.minApprovalsHint}
          inputMode="numeric"
          value={form.min_approvals}
          error={errors.min_approvals}
          onChange={(v) => setForm({ ...form, min_approvals: v })}
        />
      </section>

      <div className="flex items-center justify-end gap-4">
        {message && <span className="text-sm text-success">{message}</span>}
        <Button type="button" onClick={handleSaveClick}>
          {COPY.save}
        </Button>
      </div>
      <ConfirmModal
        open={confirmOpen}
        title={COPY.confirmTitle}
        confirmLabel={COPY.confirmLabel}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>{COPY.confirmIntro}</p>
        <ul className="mt-2 list-disc pl-5 text-foreground">
          <li>{invoiceSummary}</li>
          <li>{approvalsSummary}</li>
        </ul>
      </ConfirmModal>
    </div>
  );
}

import { Suspense } from "react";

import { InvoiceForm } from "@/components/Invoice-form/invoice-form";

export default function ResubmitInvoicePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl pt-16">
          <p role="status" className="text-sm text-foreground-muted">
            Loading rejected invoice...
          </p>
        </div>
      }
    >
      <InvoiceForm isResubmission />
    </Suspense>
  );
}

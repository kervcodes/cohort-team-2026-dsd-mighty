import { Suspense } from "react";
import { InvoiceForm } from "@/components/Invoice-form/invoice-form";

export default function EditBillPage() {
  return (
    <div className="pt-16">
      <Suspense
        fallback={
          <p role="status" className="text-sm text-foreground-muted">
            Loading invoice...
          </p>
        }
      >
        <InvoiceForm />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";

import InvoiceDetail from "./InvoiceDetail";

export default function InvoiceDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl pt-16">
          <p role="status" className="text-sm text-foreground-muted">
            Loading invoice...
          </p>
        </div>
      }
    >
      <InvoiceDetail />
    </Suspense>
  );
}

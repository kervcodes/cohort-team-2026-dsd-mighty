"use client";

import { useId } from "react";
import { BillPayments } from "@/components/Bill-payments/BillPayments";
import PayWithAi from "@/components/Pay-with-ai/PayWithAi";
import type { Bill } from "@/types/bill";

const COPY = {
  heading: "Payment",
};

type Props = {
  bill: Bill;
  // Called when either panel finds the bill paid, so the page reloads it.
  onPaid: () => void;
};

/**
 * Mark as paid and Pay with AI for an approved or paid bill: side by side
 * from `xl`, stacked below. Each panel decides by role and data what it
 * shows, and renders nothing when it has nothing; when both do, the section
 * hides (`:has` on the empty row).
 */
export function PaymentSection({ bill, onPaid }: Props) {
  const headingId = useId();

  if (bill.status !== "approved" && bill.status !== "paid") return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3 has-[>div:empty]:hidden">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {COPY.heading}
      </h2>
      <div className="flex flex-col gap-6 *:min-w-0 xl:flex-row xl:items-start xl:*:flex-1">
        <BillPayments
          billId={bill.id}
          billAmount={bill.amount}
          billStatus={bill.status}
          onPaid={onPaid}
        />
        <PayWithAi billId={bill.id} billStatus={bill.status} onPaid={onPaid} />
      </div>
    </section>
  );
}

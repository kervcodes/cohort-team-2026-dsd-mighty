import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import VendorDetail, { VendorLoading } from "./VendorDetail";

const COPY = {
  backToVendors: "Back to vendors",
};

export default function VendorDetailPage() {
  return (
    <div className="mx-auto max-w-6xl pt-16">
      <Link
        href="/vendors"
        className="mb-2 inline-flex items-center gap-1.5 rounded text-sm text-foreground-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden={true} className="h-4 w-4" />
        {COPY.backToVendors}
      </Link>
      {/* The vendor id is only known per request, so its content streams in. */}
      <Suspense fallback={<VendorLoading />}>
        <VendorDetail />
      </Suspense>
    </div>
  );
}

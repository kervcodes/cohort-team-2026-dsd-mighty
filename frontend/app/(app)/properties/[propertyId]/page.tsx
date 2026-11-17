import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import PropertyDetail, { PropertyLoading } from "./PropertyDetail";

const COPY = {
  backToProperties: "Back to properties",
};

export default function PropertyDetailPage() {
  return (
    <div className="mx-auto max-w-6xl pt-16">
      <Link
        href="/properties"
        className="mb-2 inline-flex items-center gap-1.5 rounded text-sm text-foreground-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden={true} className="h-4 w-4" />
        {COPY.backToProperties}
      </Link>
      {/* The property id is only known per request, so its content streams in. */}
      <Suspense fallback={<PropertyLoading />}>
        <PropertyDetail />
      </Suspense>
    </div>
  );
}

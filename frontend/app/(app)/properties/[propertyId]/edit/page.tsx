import { Suspense } from "react";
import PageHeader from "@/components/PageHeader/PageHeader";
import EditProperty from "./EditProperty";

const COPY = {
  title: "Edit property",
  loading: "Loading...",
};

export default function EditPropertyPage() {
  return (
    <div className="mx-auto w-full max-w-200 space-y-6 pt-16">
      <PageHeader title={COPY.title} hasCta={false} />
      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        {/* The property id is only known per request, so the form streams in. */}
        <Suspense fallback={<p role="status">{COPY.loading}</p>}>
          <EditProperty />
        </Suspense>
      </section>
    </div>
  );
}

import { Plus } from "lucide-react";
import Link from "next/link";

type PageHeaderProps = {
  title: string;
  hasCta: boolean;
  ctaText?: string;
  //   if we use a link, would need to add link prop
};
export default function PageHeader({ title, hasCta, ctaText = "Add new" }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>

      {/* Shows + add new option but dependent on user role when called.
        Currently is a link ( similar to new invoices) but may be replaced by a later modal component
    */}
      {hasCta && (
        <Link
          href="/properties/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden={true} className="h-4 w-4" />
          {ctaText}
        </Link>
      )}
    </div>
  );
}

import { Plus } from "lucide-react";
import Link from "next/link";

type BaseHeaderProps = {
  title: string;
};

type HeaderWithCta = BaseHeaderProps & {
  hasCta: true;
  ctaText: string;
  ctaLink: string;
};

type HeaderWithoutCta = BaseHeaderProps & {
  hasCta: false;
  ctaText?: never;
  ctaLink?: never;
};

type PageHeaderProps = HeaderWithCta | HeaderWithoutCta;
export default function PageHeader({ title, hasCta, ctaText, ctaLink }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>

      {hasCta && (
        <Link
          href={ctaLink}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden={true} className="h-4 w-4" />
          {ctaText}
        </Link>
      )}
    </div>
  );
}

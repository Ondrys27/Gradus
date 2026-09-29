import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  /** Primary page actions sit next to the title, never in a floating corner. */
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        // Actions drop under the text when both no longer fit on one line (tablets).
        "flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-x-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2 md:min-w-[min(100%,24rem)] md:flex-1">
        {eyebrow && <span className="micro-label">{eyebrow}</span>}
        <h1 className="page-title text-balance">{title}</h1>
        {description && <p className="max-w-2xl text-base text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

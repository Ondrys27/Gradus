import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RetryButton } from "./retry-button";

/**
 * One block of a page: a title of 15 px, an optional sentence under it, the
 * content, and a footer for what acts on the block (exports). Every chart,
 * table and breakdown sits in one of these, so a page reads as one grid.
 */
export function AdminCard({
  title,
  description,
  actions,
  footer,
  children,
  className,
  wide,
  id,
}: {
  title?: string;
  description?: string;
  /** Small controls next to the title (a status pill, a legend). */
  actions?: ReactNode;
  /** Actions with consequences go here, at the end of the block. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Spans both columns of the page grid. */
  wide?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 md:p-5",
        wide && "xl:col-span-2",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-[15px] leading-5 font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs leading-4 text-ink-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
      {footer && <footer className="mt-auto flex items-center justify-end gap-2 pt-1">{footer}</footer>}
    </section>
  );
}

/** The page grid: two columns from xl, one below; a block marked `wide` takes both. */
export function BlockGrid({
  children,
  className,
  columns = 2,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        columns === 2 ? "xl:grid-cols-2" : "md:grid-cols-2 2xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A titled part of a page (a heading of 17 px over a group of blocks). */
export function PageSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">{title}</h2>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Nothing measured yet: one sentence, no poster. A `hint` says what to do instead. */
export function AdminEmpty({
  className,
  title,
  hint,
}: {
  className?: string;
  /** A title of the page's own instead of "No data yet". */
  title?: string;
  hint?: string;
}) {
  const t = useTranslations("admin.empty");
  const heading = title ?? (hint ? null : t("title"));
  return (
    <p className={cn("py-3 text-sm text-ink-muted", className)}>
      {heading && <span className="font-medium text-ink-soft">{heading}</span>}
      {heading && " "}
      {hint ?? t("description")}
    </p>
  );
}

/** One block could not load; the rest of the page still works. */
export function AdminBlockError() {
  const t = useTranslations("admin.empty");
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pink/30 bg-pink/8 px-4 py-3 text-sm text-ink"
    >
      <span>{t("loadFailed")}</span>
      <RetryButton />
    </div>
  );
}

// --- Skeletons in the same layout as the content ------------------------------------

export function FiguresSkeleton({ count = 4, more = 0 }: { count?: number; more?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: Math.min(4, count) }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
      {more > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: more }, (_, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardSkeleton({
  height = 260,
  className,
  wide,
}: {
  height?: number;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 md:p-5",
        wide && "xl:col-span-2",
        className,
      )}
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-64" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

export function GridSkeleton({
  count,
  height,
  columns = 2,
  className,
}: {
  count: number;
  height?: number;
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <BlockGrid columns={columns} className={className}>
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} height={height} />
      ))}
    </BlockGrid>
  );
}

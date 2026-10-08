import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DatabaseIcon } from "lucide-react";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A titled card of one block of a page. */
export function AdminCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs text-ink-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Nothing measured yet: says why and that the numbers will come. */
export function AdminEmpty({ className }: { className?: string }) {
  const t = useTranslations("admin.empty");
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center",
        className,
      )}
    >
      <DatabaseIcon aria-hidden className="size-5 text-violet" />
      <p className="text-sm font-medium text-ink">{t("title")}</p>
      <p className="max-w-sm text-xs text-pretty text-ink-muted">{t("description")}</p>
    </div>
  );
}

/** One block could not load; the rest of the page still works. */
export function AdminBlockError() {
  const t = useTranslations("admin.empty");
  return <FormAlert>{t("loadFailed")}</FormAlert>;
}

export function TilesSkeleton({ count }: { count: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
      aria-hidden
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
        >
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-7 w-full" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ height = 280, className }: { height?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex flex-col gap-3 rounded-card border border-line bg-surface p-4",
        className,
      )}
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

export function GridSkeleton({
  count,
  height,
  className,
}: {
  count: number;
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 xl:grid-cols-2", className)}>
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} height={height} />
      ))}
    </div>
  );
}

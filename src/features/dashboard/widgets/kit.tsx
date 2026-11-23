"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toneSoft, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import type { WidgetKey } from "./catalog";
import type { WidgetSize } from "./grid";

/**
 * The parts every widget is made of (28.5). A widget loads its data with one
 * hook (`useData`, TanStack Query: cached, shared with its section, read again
 * when the page opens or regains focus) and draws it per size (`View`) and in
 * the opened detail (`Detail`). The frame around it (widget-frame.tsx) shows
 * the loading state in the widget's shape and an error with Retry, so a View
 * only ever gets data.
 */

export type WidgetQuery<D> = {
  data: D | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

export type WidgetSettings = Record<string, unknown>;

export type WidgetViewProps<D> = { size: WidgetSize; data: D; settings: WidgetSettings };
export type WidgetDetailProps<D> = { data: D; settings: WidgetSettings; close: () => void };

export type WidgetDef<D = unknown> = {
  key: WidgetKey;
  useData: (settings: WidgetSettings) => WidgetQuery<D>;
  View: ComponentType<WidgetViewProps<D>>;
  Detail: ComponentType<WidgetDetailProps<D>>;
  /** "Open section" of the detail when it depends on the settings or the person (a hook). */
  useHref?: (settings: WidgetSettings) => string;
};

/** Erases the data type, so widgets of every kind fit one registry. */
export function defineWidget<D>(def: WidgetDef<D>): WidgetDef<unknown> {
  return def as unknown as WidgetDef<unknown>;
}

type QueryLike = {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
};

/** One widget query out of several: data when all have it, an error when any failed. */
export function combine<D>(queries: readonly QueryLike[], build: () => D): WidgetQuery<D> {
  const ready = queries.every((query) => query.data !== undefined);
  return {
    data: ready ? build() : undefined,
    isPending: !ready && queries.some((query) => query.isPending),
    isError: queries.some((query) => query.isError && query.data === undefined),
    refetch: () => {
      for (const query of queries) void query.refetch();
    },
  };
}

/** A widget whose content fetches for itself (an existing card): always ready. */
export const READY: WidgetQuery<true> = {
  data: true,
  isPending: false,
  isError: false,
  refetch: () => undefined,
};

// ---------------------------------------------------------------------------
// Pieces of a widget's content
// ---------------------------------------------------------------------------

export function isSmall(size: WidgetSize) {
  return size === "S";
}
export function isTall(size: WidgetSize) {
  return size === "L" || size === "XL";
}

/** The big number of a widget; shrinks with the widget so long amounts never overflow. */
export function BigValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "stat-number text-[clamp(22px,15cqi,40px)] leading-none whitespace-nowrap text-ink tabular-nums",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("line-clamp-2 text-sm text-ink-soft", className)}>{children}</p>;
}

/** A row of a widget's list: a link when it leads somewhere. */
export function Row({
  href,
  lead,
  trail,
  children,
  className,
}: {
  href?: string;
  lead?: ReactNode;
  trail?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {lead && <span className="shrink-0 text-xs text-ink-muted tabular-nums">{lead}</span>}
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{children}</span>
      {trail && <span className="shrink-0 text-xs tabular-nums">{trail}</span>}
    </>
  );
  return (
    <li className={cn("min-h-10", className)}>
      {href ? (
        <Link
          href={href}
          className="flex min-h-10 items-center gap-3 rounded-lg outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {inner}
        </Link>
      ) : (
        <div className="flex min-h-10 items-center gap-3">{inner}</div>
      )}
    </li>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  return <ul className="flex min-h-0 flex-col divide-y divide-line overflow-hidden">{children}</ul>;
}

/** What a widget says when it has nothing to show: why, and often what to do. */
export function Empty({
  icon: Icon,
  tone = "neutral",
  title,
  hint,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  hint?: string;
  action?: { label: string; href: string };
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col justify-center gap-2",
        compact ? "items-start" : "items-center text-center",
      )}
    >
      {!compact && (
        <span className={cn("grid size-10 place-items-center rounded-xl border", toneSoft[tone])}>
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="line-clamp-3 max-w-xs text-xs text-pretty text-ink-muted">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="text-sm font-medium text-violet outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** The loading state in the shape of the widget's size. */
export function WidgetSkeleton({ size }: { size: WidgetSize }) {
  if (size === "S") {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (size === "M") {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      <Skeleton className="h-8 w-1/3" />
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function WidgetError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("dashboard.board");
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-pink">{t("loadFailed")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}

/** A section heading inside a detail. */
export function DetailHeading({ children }: { children: ReactNode }) {
  return <h3 className="micro-label">{children}</h3>;
}

/** A pair of numbers side by side in a detail. */
export function Figure({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
      <span className="micro-label">{label}</span>
      <span className={cn("stat-number text-xl text-ink", className)}>{value}</span>
    </div>
  );
}

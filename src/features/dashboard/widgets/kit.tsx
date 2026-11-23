"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { animate } from "framer-motion";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { toneFill, toneSoft, toneText, type Tone } from "@/components/ui/tone";
import type { Direction } from "@/features/dashboard/dashboard-logic";
import { formatNumber, type NumberFormat } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

export { Sparkline } from "@/features/dashboard/sparkline";
import type { WidgetKey } from "./catalog";
import type { WidgetSize } from "./grid";

/**
 * The parts every widget is made of (28.5, reshaped in 28.6). A widget loads
 * its data with one hook (`useData`, TanStack Query: cached, shared with its
 * section) and draws it per size (`View`) and in the opened detail (`Detail`).
 * The frame around it (widget-frame.tsx) shows the loading state in the
 * widget's shape and an error with Retry, so a View only ever gets data.
 *
 * One anatomy for every widget: `Hero` (the one number or state, readable
 * from across the room), `Sub` (the line under it), `Delta` (a change against
 * a period), and the small charts (`Columns`, `Segments`, `Ring`, `Sparkline`,
 * `MiniCalendar`). By size: S = one number or one state; M = the number plus
 * its context (a trend, a segment, the next item); L = a list or a chart;
 * XL = a chart with its legend and `Actions`. One accent per widget, the
 * colour of its section (appearance.ts), passed to every View as `tone`.
 */

export type WidgetQuery<D> = {
  data: D | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

export type WidgetSettings = Record<string, unknown>;

export type WidgetViewProps<D> = {
  size: WidgetSize;
  data: D;
  settings: WidgetSettings;
  /** The widget's accent, by its section. */
  tone: Tone;
};
export type WidgetDetailProps<D> = {
  data: D;
  settings: WidgetSettings;
  tone: Tone;
  close: () => void;
};

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
// Sizes
// ---------------------------------------------------------------------------

export function isSmall(size: WidgetSize) {
  return size === "S";
}
export function isTall(size: WidgetSize) {
  return size === "L" || size === "XL";
}

/** False on the first paint, true a frame later, so rings and bars grow from empty. */
export function useAppeared() {
  const [appeared, setAppeared] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAppeared(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return appeared;
}

/**
 * A number that is right at once and moves only when the data changes: the
 * first paint shows the value (a widget never counts up from zero when you
 * come back to the board), a later value is reached in a short tween while
 * the digits grow a touch. Tabular figures, so nothing shifts.
 */
export function LiveNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: NumberFormat;
  className?: string;
}) {
  const reduceMotion = useReducedMotionSafe();
  const settings = useFormatSettings();
  const [display, setDisplay] = useState(value);
  const [changed, setChanged] = useState(false);
  const current = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      current.current = value;
      return;
    }
    if (reduceMotion) {
      current.current = value;
      setDisplay(value);
      return;
    }
    setChanged(true);
    const controls = animate(current.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        current.current = latest;
        setDisplay(latest);
      },
      onComplete: () => setChanged(false),
    });
    return () => controls.stop();
  }, [value, reduceMotion]);

  return (
    <span
      className={cn(
        "inline-block origin-left tabular-nums transition-transform duration-300",
        changed && "scale-[1.04]",
        className,
      )}
      data-live=""
    >
      <span aria-hidden>{formatNumber(display, format, settings)}</span>
      <span className="sr-only">{formatNumber(value, format, settings)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The anatomy: Hero, Sub, Delta, Stack
// ---------------------------------------------------------------------------

/**
 * The one number of a widget: tabular figures (so a counting number never
 * jitters), shrinking with the widget so an amount never overflows. `unit`
 * sits after it, smaller. `status` colours it (pink for overdue things, green
 * for a clean zero); otherwise it is ink.
 */
export function Hero({
  children,
  unit,
  status,
  size = "lg",
  className,
}: {
  children: ReactNode;
  unit?: ReactNode;
  status?: "good" | "warn" | "bad";
  /** `lg` for S and M, `md` beside a list or a chart. */
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-1.5 leading-none font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums",
        size === "lg" ? "text-[clamp(26px,16cqi,42px)]" : "text-[clamp(22px,9cqi,30px)]",
        status === "bad" && "text-pink",
        status === "warn" && "text-gold",
        status === "good" && "text-green",
        !status && "text-ink",
        className,
      )}
      data-hero=""
    >
      <span className="min-w-0 truncate">{children}</span>
      {unit && <span className="text-[0.42em] font-semibold text-ink-soft">{unit}</span>}
    </div>
  );
}

/** @deprecated 28.5 name, kept for the detail views; new code uses Hero. */
export const BigValue = Hero;

/** The line under the hero: what the number is, or the next item. */
export function Sub({
  children,
  className,
  lines = 1,
}: {
  children: ReactNode;
  className?: string;
  lines?: 1 | 2;
}) {
  return (
    <p
      className={cn(
        "min-w-0 text-sm text-ink-soft",
        lines === 1 ? "truncate" : "line-clamp-2",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** @deprecated 28.5 name; new code uses Sub. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Sub lines={2} className={className}>
      {children}
    </Sub>
  );
}

const DELTA_ICON = { up: TrendingUpIcon, down: TrendingDownIcon, same: MinusIcon } as const;

/**
 * A change against the period before, as a small chip: the icon says the
 * direction, so the colour is never the only signal. `upIsGood` false flips
 * the colours (more expenses is not good news).
 */
export function Delta({
  direction,
  upIsGood = true,
  children,
}: {
  direction: Direction;
  upIsGood?: boolean;
  children: ReactNode;
}) {
  const Icon = DELTA_ICON[direction];
  const good = direction === "same" ? null : (direction === "up") === upIsGood;
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        good === null && "bg-surface-hover text-ink-soft",
        good === true && "bg-green/12 text-green",
        good === false && "bg-pink/12 text-pink",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The vertical rhythm of a widget's body: hero, sub, then whatever follows. */
export function Stack({
  children,
  className,
  between = false,
}: {
  children: ReactNode;
  className?: string;
  /** Pushes the last child to the bottom (a chart under a number). */
  between?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-1.5",
        between && "justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A hero with its line beside a chart or a list, in one row. */
export function Side({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      <div className="shrink-0">{aside}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists and rows
// ---------------------------------------------------------------------------

/** A row of a widget's list: a link when it leads somewhere. */
export function Row({
  href,
  lead,
  trail,
  mark,
  children,
  className,
}: {
  href?: string;
  lead?: ReactNode;
  trail?: ReactNode;
  /** A coloured dot before the text: the identity of a stage or a kind. */
  mark?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {mark && (
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", toneFill[mark])}
        />
      )}
      {lead && (
        <span className="w-16 shrink-0 truncate text-xs text-ink-muted tabular-nums">{lead}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{children}</span>
      {trail && <span className="shrink-0 text-xs tabular-nums">{trail}</span>}
    </>
  );
  return (
    <li className={cn("min-h-9", className)}>
      {href ? (
        <Link
          href={href}
          className="flex min-h-9 items-center gap-2.5 rounded-lg outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {inner}
        </Link>
      ) : (
        <div className="flex min-h-9 items-center gap-2.5">{inner}</div>
      )}
    </li>
  );
}

export function RowList({
  children,
  columns = false,
  className,
}: {
  children: ReactNode;
  /** Two columns from the wide widget on. */
  columns?: boolean;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex min-h-0 flex-col divide-y divide-line overflow-hidden",
        columns && "@3xl:grid @3xl:grid-cols-2 @3xl:gap-x-6 @3xl:divide-y-0",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** The actions of a wide widget: a row of small buttons along the bottom. */
export function Actions({
  items,
}: {
  items: readonly { label: string; href: string; primary?: boolean; icon?: LucideIcon }[];
}) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1" data-no-open="">
      {items.map(({ label, href, primary, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            buttonVariants({ variant: primary ? "default" : "outline", size: "sm" }),
            "min-h-9",
          )}
        >
          {Icon && <Icon aria-hidden data-icon="inline-start" />}
          {label}
        </Link>
      ))}
    </div>
  );
}

/** The legend of a chart: one coloured mark and a name per series. */
export function Legend({
  items,
  className,
}: {
  items: readonly { key: string; label: ReactNode; tone: Tone; value?: ReactNode }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", toneFill[item.tone])} />
          <span className="truncate">{item.label}</span>
          {item.value !== undefined && (
            <span className="font-medium text-ink tabular-nums">{item.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Small charts (dataviz: thin marks, 4 px rounded data ends, 2 px surface gaps)
// ---------------------------------------------------------------------------

/**
 * A row of columns on one baseline, at most 24 px thick, the current one in
 * the accent and the rest in its wash. Labels under them are optional.
 */
export function Columns({
  values,
  tone,
  label,
  current,
  labels,
  height = 56,
  className,
}: {
  values: readonly number[];
  tone: Tone;
  /** Read out instead of the picture. */
  label: string;
  /** Index of the column to highlight (today, this week). */
  current?: number;
  labels?: readonly string[];
  height?: number;
  className?: string;
}) {
  const appeared = useAppeared();
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={label} className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-end gap-[2px] border-b border-line/70" style={{ height }}>
        {values.map((value, index) => (
          <span key={index} className="flex min-w-0 flex-1 items-end justify-center">
            <span
              className={cn(
                "w-full max-w-6 rounded-t-[4px] transition-[height] duration-700 ease-out",
                index === current ? toneFill[tone] : cn(toneFill[tone], "opacity-35"),
              )}
              style={{
                height: appeared ? `${Math.max(value > 0 ? 6 : 2, (value / max) * 100)}%` : "2%",
              }}
            />
          </span>
        ))}
      </div>
      {labels && (
        <div className="flex gap-[2px]" aria-hidden>
          {labels.map((text, index) => (
            <span
              key={index}
              className={cn(
                "min-w-0 flex-1 truncate text-center text-[10px] tabular-nums",
                index === current ? "font-semibold text-ink" : "text-ink-muted",
              )}
            >
              {text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One whole split into parts: a thin bar with a 2 px gap of the surface
 * between the parts, fully rounded ends, nothing at zero.
 */
export function Segments({
  parts,
  label,
  thick = false,
  className,
}: {
  parts: readonly { key: string; value: number; tone: Tone }[];
  label: string;
  thick?: boolean;
  className?: string;
}) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex w-full gap-[2px] overflow-hidden rounded-full",
        thick ? "h-3" : "h-2",
        shown.length === 0 && "bg-surface-hover",
        className,
      )}
    >
      {shown.map((part) => (
        <span
          key={part.key}
          className={cn("h-full rounded-[2px] first:rounded-l-full last:rounded-r-full", toneFill[part.tone])}
          style={{ width: `${(part.value / (total || 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** One horizontal bar of a ranked list: name, value, and the bar under them. */
export function Bar({
  label,
  value,
  ratio,
  tone,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  /** 0–1 of the longest bar. */
  ratio: number;
  tone: Tone;
  href?: string;
}) {
  const appeared = useAppeared();
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", toneFill[tone])} />
          <span className="truncate text-ink-soft">{label}</span>
        </span>
        <span className="shrink-0 font-medium text-ink tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-700 ease-out",
            toneFill[tone],
          )}
          style={{ width: appeared ? `${Math.max(2, Math.min(1, ratio) * 100)}%` : "2%" }}
        />
      </div>
    </>
  );
  return (
    <li className="flex flex-col gap-1">
      {href ? (
        <Link
          href={href}
          className="flex flex-col gap-1 rounded-md outline-none hover:[&_span]:text-ink focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** The progress ring of a widget, growing from empty on the first paint. */
export function Ring({
  value,
  max,
  tone,
  label,
  size = 72,
  children,
}: {
  value: number;
  max: number;
  tone: Tone;
  label: string;
  size?: number;
  children?: ReactNode;
}) {
  const appeared = useAppeared();
  return (
    <ProgressRing
      value={appeared ? value : 0}
      max={Math.max(max, 1)}
      label={label}
      size={size}
      strokeWidth={size >= 80 ? 8 : 7}
      tone={tone}
    >
      {children}
    </ProgressRing>
  );
}

/**
 * Seven days of a week as a strip: the day's number, under it a density of
 * dots (one to three) for how much the day holds, today in the accent.
 */
export function MiniCalendar({
  days,
  tone,
  label,
}: {
  days: readonly { key: string; weekday: string; day: string; count: number; today: boolean }[];
  tone: Tone;
  label: string;
}) {
  return (
    <ol role="img" aria-label={label} className="grid grid-cols-7 gap-1">
      {days.map((entry) => (
        <li
          key={entry.key}
          className={cn(
            "flex min-w-0 flex-col items-center gap-0.5 rounded-lg py-1.5",
            entry.today && cn(toneSoft[tone], "border"),
          )}
        >
          <span
            className={cn(
              "text-[10px] font-medium uppercase",
              entry.today ? toneText[tone] : "text-ink-muted",
            )}
          >
            {entry.weekday}
          </span>
          <span className="text-sm font-semibold text-ink tabular-nums">{entry.day}</span>
          <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
            {Array.from({ length: Math.min(entry.count, 3) }, (_, index) => (
              <span key={index} className={cn("size-1.5 rounded-full", toneFill[tone])} />
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Empty, loading, error, detail pieces
// ---------------------------------------------------------------------------

/**
 * What a widget says when it has nothing to show. Never an icon alone in the
 * middle of a card: a state in words, why, and often what to do. `zero`
 * draws it as a hero "0" with the label, so a clean count still reads from
 * across the room.
 */
export function Empty({
  icon: Icon,
  tone = "neutral",
  title,
  hint,
  action,
  zero,
  compact = false,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  hint?: string;
  action?: { label: string; href: string };
  /** The formatted zero: the widget is a count and it is a clean zero. */
  zero?: string;
  /** No icon, left aligned: the small sizes. */
  compact?: boolean;
}) {
  if (zero !== undefined) {
    return (
      <Stack>
        <Hero status="good">{zero}</Hero>
        <Sub>{title}</Sub>
        {hint && !compact && <Sub className="text-xs text-ink-muted">{hint}</Sub>}
        {action && !compact && <EmptyAction {...action} />}
      </Stack>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-2">
      <div className="flex items-center gap-2.5">
        {!compact && (
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", toneSoft[tone])}>
            <Icon aria-hidden className="size-4" />
          </span>
        )}
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{title}</p>
      </div>
      {hint && <p className="line-clamp-2 text-xs text-pretty text-ink-muted">{hint}</p>}
      {action && <EmptyAction {...action} />}
    </div>
  );
}

function EmptyAction({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="self-start text-sm font-medium text-violet outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
    >
      {label}
    </Link>
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
        <Skeleton className="h-2 w-full rounded-full" />
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

/** A pair of numbers side by side in a detail, or a figure row of a wide widget. */
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
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line p-3">
      <span className="micro-label truncate">{label}</span>
      <span className={cn("truncate text-xl font-bold tracking-[-0.02em] text-ink", className)}>
        {value}
      </span>
    </div>
  );
}

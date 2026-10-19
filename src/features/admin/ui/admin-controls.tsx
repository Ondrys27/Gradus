"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangleIcon, FilterIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SEGMENT_VALUES } from "@/lib/analytics/metrics";
import { formatCalendarDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { useAdminView } from "./admin-view";
import {
  activeFilters,
  filtersFor,
  withoutFilter,
  withoutFilters,
  type ActiveFilter,
} from "../filters";
import {
  ADMIN_PERIODS,
  ADMIN_REFRESH_MS,
  ADMIN_SEGMENT_KEYS,
  parseAdminView,
  resolveRange,
  withView,
  type AdminPeriod,
  type AdminSegmentKey,
  type AdminView,
} from "../view-state";

export type SegmentOption = { value: string; label: string };
/** Values of the open segments (industry, country) the accounts actually have. */
export type OpenSegmentOptions = Partial<Record<"industry" | "country", SegmentOption[]>>;

const ALL = "__all";

/**
 * The filters the pages share: period, comparison, internal accounts, plan,
 * industry, country… and the five-minute refresh. A page shows only the
 * filters it applies (../filters.ts); the active ones are labels with a cross
 * above the content, with "Clear filters". Everything is in the address, so a
 * view can be shared and survives going to another section.
 */
export function AdminControls({
  today,
  openOptions,
}: {
  today: string;
  openOptions: OpenSegmentOptions;
}) {
  const t = useTranslations("admin.controls");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const { pending: changing, navigate } = useAdminView();
  const pending = refreshing || changing;
  const view = useMemo(() => parseAdminView(new URLSearchParams(searchParams)), [searchParams]);
  const filters = filtersFor(pathname);
  const [showSegments, setShowSegments] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  useEffect(() => setRefreshedAt(new Date()), [searchParams]);

  // Every five minutes while the tab is visible; a tab coming back after
  // longer refreshes at once.
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      last = Date.now();
      startTransition(() => router.refresh());
      setRefreshedAt(new Date());
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, ADMIN_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= ADMIN_REFRESH_MS)
        refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (filters.length === 0) return null;

  function apply(next: AdminView) {
    // No scroll to the top and the old numbers stay on screen while the new ones load.
    navigate(`${pathname}${withView(new URLSearchParams(searchParams), next)}`, "replace");
  }

  function setPeriod(period: AdminPeriod) {
    if (period === "custom") {
      const range = resolveRange(view, today);
      apply({ ...view, period, from: range.from, to: range.to });
    } else {
      apply({ ...view, period, from: null, to: null });
    }
  }

  function setSegment(key: AdminSegmentKey, value: string | null) {
    const segment = { ...view.segment };
    if (value) segment[key] = value;
    else delete segment[key];
    apply({ ...view, segment });
  }

  function optionsFor(key: AdminSegmentKey): SegmentOption[] {
    if (key === "industry" || key === "country") return openOptions[key] ?? [];
    return (SEGMENT_VALUES[key] as readonly string[]).map((value) => ({
      value,
      label: t(`segmentValues.${key}.${value}`),
    }));
  }

  function labelOf(key: AdminSegmentKey, value: string): string {
    return optionsFor(key).find((option) => option.value === value)?.label ?? value;
  }

  function periodLabel(): string {
    if (view.period === "custom" && view.from && view.to) {
      const from = formatCalendarDate(view.from, ADMIN_FORMAT_SETTINGS);
      const to = formatCalendarDate(view.to, ADMIN_FORMAT_SETTINGS);
      return view.from === view.to ? from : `${from} – ${to}`;
    }
    return t(`periods.${view.period}`);
  }

  function chipText(filter: ActiveFilter): { name: string; value: string | null } {
    switch (filter.kind) {
      case "period":
        return { name: t("period"), value: periodLabel() };
      case "compare":
        return { name: t("noCompare"), value: null };
      case "internal":
        return { name: t("internal"), value: null };
      case "segment":
        return { name: t(`segmentKeys.${filter.key}`), value: labelOf(filter.key, filter.value) };
    }
  }

  const offers = (filter: (typeof filters)[number]) => filters.includes(filter);
  const segmentKeys = ADMIN_SEGMENT_KEYS.filter((key) => offers(key));
  const active = activeFilters(view, filters);

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {offers("period") && (
        <div
          role="radiogroup"
          aria-label={t("period")}
          className="flex max-w-full overflow-x-auto rounded-full border border-line p-0.5"
        >
          {ADMIN_PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              role="radio"
              aria-checked={view.period === period}
              onClick={() => setPeriod(period)}
              className={cn(
                "h-11 shrink-0 cursor-pointer rounded-full px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
                view.period === period ? "bg-violet/20 text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {t(`periods.${period}`)}
            </button>
          ))}
        </div>
        )}

        {offers("period") && view.period === "custom" && (
          <div className="flex items-center gap-2">
            <DatePicker
              value={view.from}
              settings={ADMIN_FORMAT_SETTINGS}
              className="w-36"
              onValueChange={(from) => {
                if (!from || from > today) return;
                // Moving the start past the end moves the end along.
                apply({ ...view, from, to: view.to && view.to >= from ? view.to : from });
              }}
            />
            <span className="text-ink-muted" aria-hidden>
              –
            </span>
            <DatePicker
              value={view.to}
              settings={ADMIN_FORMAT_SETTINGS}
              className="w-36"
              onValueChange={(to) => {
                if (!to || to > today) return;
                apply({ ...view, to, from: view.from && view.from <= to ? view.from : to });
              }}
            />
          </div>
        )}

        {offers("compare") && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <Switch
              checked={view.compare}
              onCheckedChange={(compare) => apply({ ...view, compare })}
            />
            {t("compare")}
          </label>
        )}

        {offers("internal") && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <Switch
              checked={view.internal}
              onCheckedChange={(internal) => apply({ ...view, internal })}
            />
            {t("internal")}
          </label>
        )}

        {segmentKeys.length > 0 && (
          <Button
            type="button"
            variant={showSegments || active.length ? "secondary" : "ghost"}
            size="sm"
            aria-expanded={showSegments}
            aria-controls="admin-filters"
            onClick={() => setShowSegments((open) => !open)}
          >
            <FilterIcon aria-hidden />
            {active.length ? t("filtersActive", { count: active.length }) : t("filters")}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1 text-xs text-ink-muted">
          <span aria-live="polite">
            {refreshedAt
              ? t("refreshedAt", { time: formatTime(refreshedAt, ADMIN_FORMAT_SETTINGS) })
              : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("refresh")}
            disabled={pending}
            onClick={() => {
              startTransition(() => router.refresh());
              setRefreshedAt(new Date());
            }}
          >
            <RefreshCwIcon
              aria-hidden
              className={cn(pending && "animate-spin motion-reduce:animate-none")}
            />
          </Button>
        </div>
      </div>

      {showSegments && segmentKeys.length > 0 && (
        <div
          id="admin-filters"
          className="grid grid-cols-1 gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
        >
          {segmentKeys.map((key) => {
            const options = optionsFor(key);
            const items = [{ value: ALL, label: t("allValues") }, ...options];
            const id = `admin-segment-${key}`;
            return (
              <div key={key} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={id} className="micro-label">
                  {t(`segmentKeys.${key}`)}
                </label>
                <Select
                  value={view.segment[key] ?? ALL}
                  items={items}
                  onValueChange={(next) => {
                    if (typeof next !== "string") return;
                    setSegment(key, next === ALL ? null : next);
                  }}
                >
                  <SelectTrigger id={id} className="h-11 text-sm mouse:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(var(--available-height),360px)]">
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap gap-2" aria-label={t("activeFilters")}>
            {active.map((filter) => {
              const { name, value } = chipText(filter);
              const text = value ? `${name}: ${value}` : name;
              return (
                <li key={filter.kind === "segment" ? filter.key : filter.kind}>
                  <button
                    type="button"
                    onClick={() => apply(withoutFilter(view, filter))}
                    aria-label={t("removeFilter", { filter: text })}
                    className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-violet/40 bg-violet/12 px-3 text-sm text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
                  >
                    {value ? (
                      <>
                        <span className="text-ink-soft">{name}:</span>
                        {value}
                      </>
                    ) : (
                      name
                    )}
                    <XIcon aria-hidden className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => apply(withoutFilters(view, filters))}
          >
            {t("clearFilters")}
          </Button>
        </div>
      )}

      {offers("internal") && view.internal && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border-2 border-orange bg-orange/15 px-4 py-3 text-sm text-ink"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-orange" />
          <div className="flex flex-col gap-0.5">
            <strong className="font-semibold">{t("internalWarningTitle")}</strong>
            <span className="text-ink-soft">{t("internalWarning")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

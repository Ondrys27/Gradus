"use client";

import { useEffect, useState } from "react";
import { addDays, startOfWeek } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  formatWeekdayShort,
  toZonedWallClock,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

/** Current time, refreshed every 15 seconds so the preview clock stays true. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** How the chosen formats look, updating as soon as a setting changes. */
export function FormatPreview({ now }: { now: Date }) {
  const t = useTranslations("settings.preview");
  const uiLocale = useLocale();
  const settings = useFormatSettings();

  const today = toZonedWallClock(now, settings.timeZone);
  const weekStart = startOfWeek(today, { weekStartsOn: settings.weekStartsOn });
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const rows: { label: string; value: string }[] = [
    { label: t("number"), value: formatNumber(1234567.89, { decimals: 2 }, settings) },
    { label: t("amount"), value: formatNumber(184500, { style: "currency" }, settings) },
    { label: t("percent"), value: formatNumber(0.342, { style: "percent", decimals: 1 }, settings) },
    { label: t("date"), value: formatDate(now, settings) },
    { label: t("time"), value: formatTime(now, settings) },
    { label: t("dateTime"), value: formatDateTime(now, settings) },
  ];

  return (
    <div className="flex flex-col gap-4 pt-1">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">{row.label}</dt>
            <dd
              className="truncate text-sm font-semibold text-ink tabular-nums"
              suppressHydrationWarning
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-muted">{t("week")}</span>
        <ol className="grid grid-cols-7 gap-1">
          {week.map((day) => {
            const isToday = day.toDateString() === today.toDateString();
            return (
              <li
                key={day.toISOString()}
                className={cn(
                  "flex h-9 items-center justify-center rounded-lg border text-xs font-medium capitalize",
                  isToday ? "border-violet/60 bg-violet/20 text-ink" : "border-line text-ink-soft",
                )}
                suppressHydrationWarning
              >
                {formatWeekdayShort(day, uiLocale)}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

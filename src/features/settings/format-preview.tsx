"use client";

import { useEffect, useState } from "react";
import { addDays, startOfWeek } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { GlowCard } from "@/components/ui/glow-card";
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

/** Shows how the chosen formats look, updating as soon as a setting changes. */
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
    {
      label: t("percent"),
      value: formatNumber(0.342, { style: "percent", decimals: 1 }, settings),
    },
    { label: t("date"), value: formatDate(now, settings) },
    { label: t("time"), value: formatTime(now, settings) },
    { label: t("dateTime"), value: formatDateTime(now, settings) },
  ];

  return (
    <GlowCard interactive={false} className="flex flex-col gap-5 md:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1.5 rounded-xl border border-line bg-canvas-deep/60 px-4 py-3"
          >
            <dt className="micro-label">{row.label}</dt>
            <dd className="text-lg font-semibold text-ink tabular-nums" suppressHydrationWarning>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <span className="micro-label">{t("week")}</span>
        <ol className="grid grid-cols-7 gap-1.5">
          {week.map((day) => {
            const isToday = day.toDateString() === today.toDateString();
            return (
              <li
                key={day.toISOString()}
                className={cn(
                  "flex h-11 items-center justify-center rounded-lg border text-xs font-medium capitalize",
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
    </GlowCard>
  );
}

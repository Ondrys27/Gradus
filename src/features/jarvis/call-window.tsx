"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MoonIcon } from "lucide-react";
import { useUserSettings } from "@/features/account/queries";
import { useCallTimeStats } from "@/features/cold-calling/stats-queries";
import {
  formatTime,
  formatWeekdayLong,
  instantToZonedParts,
  isoDateToLocal,
  todayIsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { timeWindow, type TimeWindow } from "./time-window";

/** The window is re-read this often, so the notice comes and goes on time. */
const TICK_MS = 60_000;

/** Whether people may be reached now, in the user's zone and country, kept current. */
export function useCallWindow(): TimeWindow {
  const settings = useFormatSettings();
  const country = useUserSettings().country_code || null;
  const stats = useCallTimeStats(country);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return useMemo(
    () => timeWindow({ now, timeZone: settings.timeZone, country, stats: stats.data }),
    [now, settings.timeZone, country, stats.data],
  );
}

/** "tomorrow 8:00", "Monday 8:00": a coming moment in the user's zone and time format. */
export function useWhenLabel() {
  const t = useTranslations("jarvis.callWindow");
  const settings = useFormatSettings();
  const locale = useLocale();
  return useCallback(
    (at: Date) => {
      const time = formatTime(at, settings);
      const { date } = instantToZonedParts(at, settings.timeZone);
      const today = todayIsoDate(settings);
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (date === today) return t("today", { time });
      if (date === tomorrow) return t("tomorrow", { time });
      return t("day", { day: formatWeekdayLong(isoDateToLocal(date), locale), time });
    },
    [t, settings, locale],
  );
}

/**
 * Outside the time window: a calm note that people mostly do not pick up now
 * and when they will, instead of a call to action. It never blocks anything.
 */
export function CallWindowNotice({ className }: { className?: string }) {
  const t = useTranslations("jarvis.callWindow");
  const win = useCallWindow();
  const when = useWhenLabel();
  if (win.open) return null;
  const reason =
    win.reason === "weekend" || win.reason === "holiday" || win.reason === "beforeHours"
      ? win.reason
      : "afterHours";

  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-line bg-surface-hover px-3 py-2.5 text-sm text-ink-soft",
        className,
      )}
    >
      <MoonIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-violet" />
      <span>
        {t(`closed.${reason}`)} {win.nextOpenAt && t("next", { when: when(win.nextOpenAt) })}{" "}
        {t("prepare")}
      </span>
    </p>
  );
}

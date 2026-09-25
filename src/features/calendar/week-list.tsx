"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatTime, isoDateToLocal, weekdayName, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { DayNumber } from "./day-number";
import { itemClass, MirrorIcon } from "./item-chip";
import type { CalendarItem } from "./types";
import { useSwipe } from "./use-swipe";

type Props = {
  days: IsoDate[];
  today: IsoDate;
  items: Map<IsoDate, CalendarItem[]>;
  onPickDay: (day: IsoDate) => void;
  onOpenItem: (item: CalendarItem) => void;
  onSwipe: (direction: 1 | -1) => void;
};

/** The week on a phone: the days one under the other, each with its items. */
export function WeekList({ days, today, items, onPickDay, onOpenItem, onSwipe }: Props) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const swipe = useSwipe(onSwipe);

  return (
    <ol {...swipe} className="flex flex-col gap-2">
      {days.map((day) => {
        const list = items.get(day) ?? [];
        const date = isoDateToLocal(day);
        const isToday = day === today;
        return (
          <li
            key={day}
            className={cn(
              "flex gap-3 rounded-card border bg-surface p-2",
              isToday ? "border-violet/50" : "border-line",
            )}
          >
            <button
              type="button"
              onClick={() => onPickDay(day)}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${weekdayName(date.getDay(), locale)} ${date.getDate()}`}
              className="flex min-h-11 w-14 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <span className="text-xs font-semibold text-ink-muted uppercase">
                {weekdayName(date.getDay(), locale).slice(0, 3)}
              </span>
              <DayNumber date={date} isToday={isToday} settings={settings} />
            </button>
            <ul className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
              {list.length === 0 && (
                <li className="min-h-11 content-center text-sm text-ink-muted">
                  {t("nothingPlanned")}
                </li>
              )}
              {list.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className={cn(
                      "flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      itemClass(item),
                    )}
                  >
                    <MirrorIcon item={item} className="size-4" />
                    <span className="shrink-0 text-xs tabular-nums opacity-80">
                      {item.type === "event" && !item.allDay
                        ? formatTime(new Date(item.startMs), settings)
                        : t("allDayShort")}
                    </span>
                    <span className="truncate font-medium">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

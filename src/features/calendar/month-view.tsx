"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCalendarDate, isoDateToLocal, weekdayShortName, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { toneFill, toneText } from "@/components/ui/tone";
import { dotsForDay, isSameMonth } from "./calendar-logic";
import { DayNumber } from "./day-number";
import { ItemChip } from "./item-chip";
import type { CalendarItem } from "./types";
import { useSwipe } from "./use-swipe";

/** Bars shown per day on larger screens before "+N more". */
const MAX_CHIPS = 3;

type Props = {
  days: IsoDate[];
  cursor: IsoDate;
  today: IsoDate;
  isPhone: boolean;
  items: Map<IsoDate, CalendarItem[]>;
  onPickDay: (day: IsoDate) => void;
  onOpenItem: (item: CalendarItem) => void;
  onSwipe: (direction: 1 | -1) => void;
};

export function MonthView({
  days,
  cursor,
  today,
  isPhone,
  items,
  onPickDay,
  onOpenItem,
  onSwipe,
}: Props) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const swipe = useSwipe(onSwipe);

  return (
    <div {...swipe} className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-semibold text-ink-muted uppercase"
          >
            {weekdayShortName(isoDateToLocal(day).getDay(), locale)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const list = items.get(day) ?? [];
          const isToday = day === today;
          const dimmed = !isSameMonth(day, cursor);
          const dots = dotsForDay(list);
          return (
            <div
              key={day}
              className={cn(
                "relative border-line",
                index % 7 !== 0 && "border-l",
                index >= 7 && "border-t",
                isPhone ? "min-h-14" : "min-h-28",
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                aria-label={formatCalendarDate(day, settings)}
                aria-current={isToday ? "date" : undefined}
                className="absolute inset-0 cursor-pointer outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
              />
              <div
                className={cn(
                  "pointer-events-none relative flex flex-col gap-1 p-1",
                  isPhone ? "items-center" : "items-stretch",
                  dimmed && "opacity-45",
                )}
              >
                <DayNumber
                  date={isoDateToLocal(day)}
                  isToday={isToday}
                  settings={settings}
                  className={isPhone ? undefined : "self-start"}
                />
                {isPhone ? (
                  <div aria-hidden className="flex h-2 items-center gap-1">
                    {dots.tones.map((dot, dotIndex) => (
                      <span
                        key={dotIndex}
                        className={cn(
                          "size-1.5 rounded-full",
                          dot.mirror
                            ? cn("bg-transparent ring-1 ring-current", toneText[dot.tone])
                            : toneFill[dot.tone],
                        )}
                      />
                    ))}
                    {dots.more && <span className="size-1.5 rounded-full bg-ink-muted" />}
                  </div>
                ) : (
                  <div className="pointer-events-auto flex flex-col gap-0.5">
                    {list.slice(0, MAX_CHIPS).map((item) => (
                      <ItemChip key={item.key} item={item} onOpen={onOpenItem} showTime />
                    ))}
                    {list.length > MAX_CHIPS && (
                      <span className="px-1 text-xs text-ink-muted">
                        {t("more", { count: list.length - MAX_CHIPS })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

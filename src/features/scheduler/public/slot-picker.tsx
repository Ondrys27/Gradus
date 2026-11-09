"use client";

import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatMonthYear,
  formatNumber,
  formatTime,
  formatWeekdayLong,
  weekdayShortName,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { bookableMonths, dayNumber, monthGrid, type Month } from "../booking/calendar";
import type { GuestDay, GuestSlot } from "../slots";
import { parseDay } from "../zoned";

/**
 * The month calendar and the times of the picked day (24.4), in the guest's
 * zone. Days without a free time are quiet and cannot be picked. Shared by
 * booking a time and moving a booking.
 */
export function SlotPicker({
  days,
  selected,
  onPick,
  disabled = false,
}: {
  days: readonly GuestDay[];
  /** The start of the picked time, ms. */
  selected: number | null;
  onPick: (slot: GuestSlot) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("booking.calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const byDay = useMemo(() => new Map(days.map((day) => [day.day, day.slots])), [days]);
  const months = useMemo(() => bookableMonths(days.map((day) => day.day)), [days]);
  const selectedDay = useMemo(
    () => (selected ? (days.find((day) => day.slots.some((slot) => slot.start === selected))?.day ?? null) : null),
    [days, selected],
  );
  const [month, setMonth] = useState<Month | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const shownMonth = month && months.includes(month) ? month : (months[0] ?? null);
  const shownDay = day && byDay.has(day) ? day : selectedDay;

  if (!shownMonth) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-ink-muted" data-testid="booking-no-slots">
        {t("noSlots")}
      </p>
    );
  }

  const index = months.indexOf(shownMonth);
  const { year, month: monthNumber } = parseDay(`${shownMonth}-01`);
  const cells = monthGrid(shownMonth, settings.weekStartsOn);
  const times = shownDay ? (byDay.get(shownDay) ?? []) : [];

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t("previousMonth")}
            disabled={index <= 0}
            onClick={() => setMonth(months[index - 1] ?? shownMonth)}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-30 mouse:size-9"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </button>
          <h3 className="text-base font-semibold text-ink capitalize" data-testid="booking-month">
            {formatMonthYear(new Date(year, monthNumber - 1, 1), locale)}
          </h3>
          <button
            type="button"
            aria-label={t("nextMonth")}
            disabled={index >= months.length - 1}
            onClick={() => setMonth(months[index + 1] ?? shownMonth)}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-30 mouse:size-9"
          >
            <ChevronRightIcon aria-hidden className="size-4" />
          </button>
        </div>
        <div role="group" aria-label={t("pickDay")} className="grid grid-cols-7 gap-1 text-center">
          {Array.from({ length: 7 }, (_, i) => (settings.weekStartsOn + i) % 7).map((weekday) => (
            <span key={weekday} aria-hidden className="micro-label py-1">
              {weekdayShortName(weekday, locale)}
            </span>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <span key={`empty-${i}`} aria-hidden />;
            const free = byDay.has(cell);
            const active = cell === shownDay;
            return (
              <button
                key={cell}
                type="button"
                disabled={!free || disabled}
                aria-pressed={active}
                aria-label={free ? t("dayFree", { day: formatWeekdayLong(new Date(year, monthNumber - 1, dayNumber(cell)), locale), number: dayNumber(cell) }) : undefined}
                data-testid={free ? "booking-day" : undefined}
                data-day={cell}
                onClick={() => setDay(cell)}
                className={cn(
                  "grid aspect-square min-h-11 place-items-center rounded-xl text-sm tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
                  free
                    ? "cursor-pointer bg-violet/10 font-semibold text-ink hover:bg-violet/20"
                    : "text-ink-muted/50",
                  active && "bg-violet text-white hover:bg-violet",
                )}
              >
                {formatNumber(dayNumber(cell), {}, settings)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2" aria-live="polite">
        <h3 className="micro-label">{shownDay ? t("timesOf") : t("pickDay")}</h3>
        {shownDay ? (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" data-testid="booking-times">
            {times.map((slot) => (
              <li key={slot.start}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={slot.start === selected}
                  data-testid="booking-time"
                  data-start={slot.start}
                  onClick={() => onPick(slot)}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border text-sm font-semibold tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60 mouse:min-h-10",
                    slot.start === selected
                      ? "border-violet bg-violet text-white"
                      : "border-line bg-surface text-ink hover:border-violet",
                  )}
                >
                  {formatTime(new Date(slot.start), settings)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{t("pickDayHint")}</p>
        )}
      </div>
    </div>
  );
}


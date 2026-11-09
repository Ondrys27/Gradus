"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatMonthYear,
  formatNumber,
  formatSpokenDate,
  formatTime,
  formatWeekdayLong,
  weekdayShortName,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { bookableMonths, dayNumber, monthGrid, type Month } from "../booking/calendar";
import type { GuestDay, GuestSlot } from "../slots";
import { parseDay } from "../zoned";

export type PickerView = "days" | "times";

/**
 * The month calendar and the times of the picked day (24.4, drawn in 24.5),
 * in the guest's zone. Free days stand in ink with a small teal dot under
 * the number, days without a free time are quiet and cannot be picked; the
 * picked day and time sit in violet. On a wide screen the two stand side by
 * side; on a phone the calendar gives way to the day's times, with a way
 * back. Shared by booking a time and moving a booking.
 */
export function SlotPicker({
  days,
  selected,
  onPick,
  onViewChange,
  disabled = false,
}: {
  days: readonly GuestDay[];
  /** The start of the picked time, ms. */
  selected: number | null;
  onPick: (slot: GuestSlot) => void;
  /** Which step a phone shows, for the step line above. */
  onViewChange?: (view: PickerView) => void;
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
  const [view, setView] = useState<PickerView>("days");
  const shownMonth = month && months.includes(month) ? month : (months[0] ?? null);
  const shownDay = day && byDay.has(day) ? day : selectedDay;

  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

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
  const spokenDay = shownDay ? formatSpokenDate(new Date(times[0]?.start ?? Date.now()), settings, locale) : null;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_11rem] md:gap-8">
      <div
        key={view === "days" ? "days" : "days-behind"}
        className={cn(
          "flex flex-col gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-4 motion-safe:duration-300 md:animate-none",
          view === "times" && "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t("previousMonth")}
            disabled={index <= 0}
            onClick={() => setMonth(months[index - 1] ?? shownMonth)}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-30 mouse:size-9"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </button>
          <h3 className="font-display text-lg font-bold tracking-tight text-ink capitalize" data-testid="booking-month">
            {formatMonthYear(new Date(year, monthNumber - 1, 1), locale)}
          </h3>
          <button
            type="button"
            aria-label={t("nextMonth")}
            disabled={index >= months.length - 1}
            onClick={() => setMonth(months[index + 1] ?? shownMonth)}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-30 mouse:size-9"
          >
            <ChevronRightIcon aria-hidden className="size-4" />
          </button>
        </div>
        <div role="group" aria-label={t("pickDay")} className="grid grid-cols-7 gap-1 text-center">
          {Array.from({ length: 7 }, (_, i) => (settings.weekStartsOn + i) % 7).map((weekday) => (
            <span key={weekday} aria-hidden className="micro-label py-1.5">
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
                onClick={() => {
                  setDay(cell);
                  setView("times");
                }}
                className={cn(
                  "relative grid aspect-square min-h-11 place-items-center rounded-xl text-sm tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
                  free
                    ? "cursor-pointer font-semibold text-ink after:absolute after:bottom-1.5 after:size-1 after:rounded-full after:bg-teal hover:bg-surface-hover"
                    : "text-ink-muted/40",
                  active && "bg-violet text-white shadow-glow after:bg-white/80 hover:bg-violet",
                )}
              >
                {formatNumber(dayNumber(cell), {}, settings)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-ink-muted md:hidden">{t("pickDayHint")}</p>
      </div>

      <div
        key={shownDay ?? "no-day"}
        className={cn(
          "flex flex-col gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300",
          view === "days" && "hidden md:flex",
        )}
        aria-live="polite"
      >
        {shownDay ? (
          <>
            <button
              type="button"
              onClick={() => setView("days")}
              className="flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-lg pr-2 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
            >
              <ChevronLeftIcon aria-hidden className="size-4" />
              {t("anotherDay")}
            </button>
            <h3 className="flex flex-col gap-0.5">
              <span className="micro-label">{t("timesOf")}</span>
              <span className="block font-display text-base font-bold text-ink first-letter:uppercase">{spokenDay}</span>
            </h3>
            <ul
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:max-h-80 md:flex-col md:overflow-y-auto md:pr-1"
              data-testid="booking-times"
            >
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
                      "flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60 mouse:min-h-10",
                      slot.start === selected
                        ? "border-violet bg-violet text-white"
                        : "border-line bg-canvas/40 text-ink hover:border-line-strong hover:bg-surface-hover",
                    )}
                  >
                    {formatTime(new Date(slot.start), settings)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h3 className="micro-label">{t("pickDay")}</h3>
            <p className="text-sm text-ink-muted text-pretty">{t("pickDayHint")}</p>
          </>
        )}
      </div>
    </div>
  );
}

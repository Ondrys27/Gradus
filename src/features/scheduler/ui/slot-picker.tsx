"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  formatDayMonth,
  formatIsoTime,
  formatSlotMoment,
  weekdayShortName,
  type IsoTime,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
  dayCells,
  dayState,
  freeSlotAt,
  stateAt,
  weekDays,
  weekGrid,
  weekOfDay,
  weeksOf,
  type CellState,
  type GridCell,
} from "../slot-grid";
import type { GuestDay, GuestSlot } from "../slots";
import { weekdayOf, type Day } from "../zoned";

export type PickerView = "days" | "times";

type Notice = { start: number; state: Exclude<CellState, "free"> };

/**
 * The one way to pick a meeting time (30.4), on the public booking page and
 * in the app: a week of days, then the day's times. Free times stand in
 * green, taken ones grey with "Full" (never why), times outside the hours
 * quiet. On a wide screen the whole week is one grid; on a phone the week's
 * days in a row and the picked day's times under them.
 *
 * A taken time or one typed by hand outside the offer is never booked by a
 * click: "That time is already full", and only in the app (`onForce`) a
 * "Book anyway". The public page has neither the hand entry nor the force.
 */
export function SlotPicker({
  days,
  timeZone,
  selected,
  onPick,
  onForce,
  manualEntry = false,
  onViewChange,
  disabled = false,
}: {
  days: readonly GuestDay[];
  /** The zone the days are in (the viewer's). */
  timeZone: string;
  /** The start of the picked time, ms. */
  selected: number | null;
  onPick: (slot: GuestSlot) => void;
  /** The app only: book a taken time or one outside the offer anyway. */
  onForce?: (start: number) => void;
  /** The app only: type a time by hand. */
  manualEntry?: boolean;
  onViewChange?: (view: PickerView) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("booking.calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const phone = useIsPhone();
  const weeks = useMemo(() => weeksOf(days), [days]);
  const byDay = useMemo(() => new Map(days.map((day) => [day.day, day])), [days]);
  const firstFree = useMemo(() => days.find((day) => day.slots.length)?.day ?? null, [days]);
  const selectedDay = useMemo(
    () =>
      selected
        ? (days.find((day) =>
            [...day.slots, ...(day.busy ?? [])].some((slot) => slot.start === selected),
          )?.day ?? null)
        : null,
    [days, selected],
  );
  const [week, setWeek] = useState<Day | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const shownDay = day ?? selectedDay ?? firstFree;
  const fallbackWeek = shownDay ? weekOfDay(weeks, shownDay) : (weeks[0] ?? null);
  const shownWeek = week && weeks.includes(week) ? week : fallbackWeek;

  useEffect(() => {
    onViewChange?.(touched ? "times" : "days");
  }, [touched, onViewChange]);

  if (!shownWeek) {
    return (
      <p
        className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-ink-muted"
        data-testid="booking-no-slots"
      >
        {t("noSlots")}
      </p>
    );
  }

  const index = weeks.indexOf(shownWeek);
  const dates = weekDays(shownWeek);

  function chooseDay(next: Day) {
    setDay(next);
    setTouched(true);
    setNotice(null);
  }

  function clickCell(cell: GridCell) {
    if (disabled) return;
    setDay(cell.day);
    setTouched(true);
    if (cell.state === "free" && cell.end !== null) {
      setNotice(null);
      onPick({ start: cell.start, end: cell.end, time: cell.time });
      return;
    }
    setNotice({ start: cell.start, state: cell.state === "busy" ? "busy" : "off" });
  }

  function typed(value: string | null) {
    setManual(value);
    if (!value) return;
    const start = Date.parse(value);
    if (!Number.isFinite(start)) return;
    const state = stateAt(days, start);
    const slot = state === "free" ? freeSlotAt(days, start) : null;
    if (slot) {
      setNotice(null);
      onPick(slot);
      return;
    }
    setNotice({ start, state: state === "busy" ? "busy" : "off" });
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        aria-label={t("previousWeek")}
        disabled={index <= 0}
        onClick={() => {
          setWeek(weeks[index - 1] ?? shownWeek);
          setDay(null);
          setNotice(null);
        }}
        className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-30 mouse:size-9"
      >
        <ChevronLeftIcon aria-hidden className="size-4" />
      </button>
      <h3
        className="font-display text-base font-bold tracking-tight text-ink tabular-nums"
        data-testid="booking-month"
      >
        {t("weekRange", {
          from: formatDayMonth(dates[0], settings),
          to: formatDayMonth(dates[6], settings),
        })}
      </h3>
      <button
        type="button"
        aria-label={t("nextWeek")}
        disabled={index < 0 || index >= weeks.length - 1}
        onClick={() => {
          setWeek(weeks[index + 1] ?? shownWeek);
          setDay(null);
          setNotice(null);
        }}
        className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-30 mouse:size-9"
      >
        <ChevronRightIcon aria-hidden className="size-4" />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="slot-picker">
      {header}
      {phone ? (
        <PhoneWeek
          dates={dates}
          byDay={byDay}
          shownDay={shownDay}
          selected={selected}
          disabled={disabled}
          onDay={chooseDay}
          onCell={clickCell}
        />
      ) : (
        <WideWeek
          days={days}
          weekStart={shownWeek}
          timeZone={timeZone}
          byDay={byDay}
          shownDay={shownDay}
          selected={selected}
          disabled={disabled}
          onDay={chooseDay}
          onCell={clickCell}
        />
      )}
      <Legend />

      {manualEntry && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-3">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink-soft">
            <ClockIcon aria-hidden className="size-4" />
            {t("manualTitle")}
          </span>
          <DateTimePicker
            id="slot-manual"
            value={manual}
            timeLabel={t("manualTime")}
            datePlaceholder={t("manualDate")}
            onValueChange={typed}
          />
        </div>
      )}

      {notice && (
        <div
          role="status"
          data-testid="slot-busy-notice"
          data-state={notice.state}
          className="flex items-start gap-2.5 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-3 text-sm text-ink"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
          <span className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t(notice.state === "busy" ? "busyNotice" : "offNotice", {
                when: formatSlotMoment(new Date(notice.start), settings, locale),
              })}
            </span>
            {onForce && notice.start > Date.now() && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                data-testid="slot-force"
                onClick={() => onForce(notice.start)}
              >
                {t("bookAnyway")}
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function Legend() {
  const t = useTranslations("booking.calendar.legend");
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-hidden>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-green" />
        {t("free")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-ink-muted/50" />
        {t("busy")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border border-dashed border-line-strong" />
        {t("off")}
      </li>
    </ul>
  );
}

type DayButtonProps = {
  date: Day;
  state: CellState;
  active: boolean;
  disabled: boolean;
  onDay: (day: Day) => void;
  compact?: boolean;
};

function DayButton({ date, state, active, disabled, onDay, compact }: DayButtonProps) {
  const t = useTranslations("booking.calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const weekday = weekdayShortName(weekdayOf(date), locale);
  return (
    <button
      type="button"
      disabled={disabled || state === "off"}
      aria-pressed={active}
      aria-label={t(state === "free" ? "dayFreeLabel" : "dayFullLabel", {
        day: weekday,
        date: formatDayMonth(date, settings),
      })}
      data-testid={state === "free" ? "booking-day" : undefined}
      data-day={date}
      onClick={() => onDay(date)}
      className={cn(
        "flex min-h-11 w-full cursor-pointer flex-col items-center justify-center rounded-xl px-1 py-1 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
        compact ? "gap-0" : "gap-0.5",
        state === "free" && "text-ink hover:bg-surface-hover",
        state === "busy" && "text-ink-muted hover:bg-surface-hover",
        state === "off" && "text-ink-muted/40",
        active && "bg-violet text-on-violet shadow-glow hover:bg-violet",
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide">{weekday}</span>
      <span className="text-sm font-semibold tabular-nums">{formatDayMonth(date, settings)}</span>
      {state === "busy" && !active && <span className="text-[10px]">{t("full")}</span>}
      {state === "free" && !active && (
        <span aria-hidden className="mt-0.5 size-1 rounded-full bg-green" />
      )}
    </button>
  );
}

function CellButton({
  cell,
  inShownDay,
  selected,
  disabled,
  onCell,
  wide,
}: {
  cell: GridCell;
  inShownDay: boolean;
  selected: boolean;
  disabled: boolean;
  onCell: (cell: GridCell) => void;
  wide?: boolean;
}) {
  const t = useTranslations("booking.calendar");
  const settings = useFormatSettings();
  const time = formatIsoTime(cell.time as IsoTime, settings);
  return (
    <button
      type="button"
      disabled={disabled || (cell.state === "off" && cell.start <= Date.now())}
      aria-pressed={selected}
      aria-label={
        cell.state === "free" ? time : t(cell.state === "busy" ? "cellBusy" : "cellOff", { time })
      }
      // The free times of the picked day are what the steps (and the tests) choose from.
      data-testid={
        cell.state === "free"
          ? inShownDay
            ? "booking-time"
            : "booking-slot"
          : cell.state === "busy"
            ? "slot-busy"
            : "slot-off"
      }
      data-start={cell.start}
      onClick={() => onCell(cell)}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border text-xs font-semibold tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
        wide ? "min-h-9" : "min-h-11",
        cell.state === "free" &&
          "border-green/40 bg-green/10 text-ink hover:border-green/70 hover:bg-green/20",
        cell.state === "busy" && "border-line bg-surface-hover/60 text-ink-muted",
        cell.state === "off" && "border-dashed border-line/60 text-ink-muted/40",
        selected && "border-violet bg-violet text-on-violet hover:border-violet hover:bg-violet",
      )}
    >
      <span>{time}</span>
      {cell.state === "busy" && <span className="text-[10px] font-normal">{t("full")}</span>}
    </button>
  );
}

function WideWeek({
  days,
  weekStart,
  timeZone,
  byDay,
  shownDay,
  selected,
  disabled,
  onDay,
  onCell,
}: {
  days: readonly GuestDay[];
  weekStart: Day;
  timeZone: string;
  byDay: Map<Day, GuestDay>;
  shownDay: Day | null;
  selected: number | null;
  disabled: boolean;
  onDay: (day: Day) => void;
  onCell: (cell: GridCell) => void;
}) {
  const t = useTranslations("booking.calendar");
  const grid = useMemo(() => weekGrid(days, weekStart, timeZone), [days, weekStart, timeZone]);
  return (
    <div className="flex flex-col gap-1" role="grid" aria-label={t("pickTime")}>
      <div className="grid grid-cols-7 gap-1" role="row">
        {grid.days.map((date) => (
          <DayButton
            key={date}
            date={date}
            state={dayState(byDay.get(date))}
            active={date === shownDay}
            disabled={disabled}
            onDay={onDay}
            compact
          />
        ))}
      </div>
      <div className="max-h-80 overflow-y-auto pr-1" data-testid="booking-times">
        {grid.rows.length === 0 ? (
          <p className="px-1 py-4 text-sm text-ink-muted">{t("weekEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {grid.rows.map((row) => (
              <div key={row.time} className="grid grid-cols-7 gap-1" role="row">
                {row.cells.map((cell) => (
                  <div
                    key={`${cell.day}-${cell.time}`}
                    role="gridcell"
                    className={cn("rounded-lg", cell.day === shownDay && "bg-violet/5")}
                  >
                    <CellButton
                      cell={cell}
                      inShownDay={cell.day === shownDay}
                      selected={cell.start === selected}
                      disabled={disabled}
                      onCell={onCell}
                      wide
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PhoneWeek({
  dates,
  byDay,
  shownDay,
  selected,
  disabled,
  onDay,
  onCell,
}: {
  dates: Day[];
  byDay: Map<Day, GuestDay>;
  shownDay: Day | null;
  selected: number | null;
  disabled: boolean;
  onDay: (day: Day) => void;
  onCell: (cell: GridCell) => void;
}) {
  const t = useTranslations("booking.calendar");
  const entry = shownDay ? byDay.get(shownDay) : undefined;
  const cells = entry ? dayCells(entry) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1" role="group" aria-label={t("pickDay")}>
        {dates.map((date) => (
          <DayButton
            key={date}
            date={date}
            state={dayState(byDay.get(date))}
            active={date === shownDay}
            disabled={disabled}
            onDay={onDay}
          />
        ))}
      </div>
      <div aria-live="polite">
        {cells.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("pickDayHint")}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2" data-testid="booking-times">
            {cells.map((cell) => (
              <li key={cell.start}>
                <CellButton
                  cell={cell}
                  inShownDay
                  selected={cell.start === selected}
                  disabled={disabled}
                  onCell={onCell}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

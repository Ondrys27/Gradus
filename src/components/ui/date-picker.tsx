"use client";

import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { addDays, addMonths, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  DEFAULT_FORMAT_SETTINGS,
  formatCalendarDate,
  formatDayOfMonth,
  formatMonthYear,
  formatWeekdayShort,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  type FormatSettings,
  type IsoDate,
} from "@/lib/format";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./bottom-sheet";

type DatePickerProps = {
  value: IsoDate | null;
  onValueChange: (value: IsoDate | null) => void;
  placeholder?: string;
  settings?: FormatSettings;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** Calendar-date picker (no time, no time zone). Replaces the native date input. */
export function DatePicker({
  value,
  onValueChange,
  placeholder,
  settings = DEFAULT_FORMAT_SETTINGS,
  disabled,
  id,
  className,
}: DatePickerProps) {
  const t = useTranslations("common.datePicker");
  const isPhone = useIsPhone();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = value ? isoDateToLocal(value) : null;
  const today = isoDateToLocal(todayIsoDate(settings));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(selected ?? today));

  function handleOpenChange(next: boolean) {
    if (next) setMonth(startOfMonth(selected ?? today));
    setOpen(next);
  }

  function change(next: IsoDate | null) {
    onValueChange(next);
    setOpen(false);
  }

  const calendar = (
    <Calendar
      month={month}
      onMonthChange={setMonth}
      selected={selected}
      today={today}
      value={value}
      onChange={change}
      settings={settings}
    />
  );

  // One trigger for both layouts. On phones the popover stays closed and a bottom sheet opens.
  return (
    <>
      <Popover.Root open={open && !isPhone} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          ref={triggerRef}
          id={id}
          disabled={disabled}
          className={cn("field cursor-pointer justify-between gap-2 text-left", className)}
        >
          <span className={cn("truncate", !value && "text-ink-muted")}>
            {value ? formatCalendarDate(value, settings) : placeholder}
          </span>
          <CalendarIcon className="size-4 shrink-0 text-ink-muted" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            sideOffset={6}
            align="start"
            // 16 px page gutter at the sides; vertically the calendar may come closer to the edge
            // so it still fits below or above the field before falling back to its side.
            collisionPadding={{ top: 8, bottom: 8, left: 16, right: 16 }}
            className="z-50"
          >
            <Popover.Popup
              aria-label={t("title")}
              className={cn(
                "w-86 origin-(--transform-origin) rounded-2xl border border-line-strong bg-surface p-3 shadow-popover outline-none mouse:w-76",
                "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
              )}
            >
              {calendar}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {isPhone && (
        <BottomSheet
          open={open}
          onOpenChange={handleOpenChange}
          title={t("title")}
          closeLabel={t("close")}
          finalFocus={triggerRef}
        >
          {calendar}
        </BottomSheet>
      )}
    </>
  );
}

type CalendarProps = {
  month: Date;
  onMonthChange: (month: Date) => void;
  selected: Date | null;
  today: Date;
  value: IsoDate | null;
  onChange: (value: IsoDate | null) => void;
  settings: FormatSettings;
};

function Calendar({
  month,
  onMonthChange,
  selected,
  today,
  value,
  onChange,
  settings,
}: CalendarProps) {
  const t = useTranslations("common.datePicker");
  const uiLocale = useLocale();
  const gridStart = startOfWeek(month, { weekStartsOn: settings.weekStartsOn });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <NavButton label={t("previousMonth")} onClick={() => onMonthChange(addMonths(month, -1))}>
          <ChevronLeftIcon className="size-4" />
        </NavButton>
        <span aria-live="polite" className="text-sm font-semibold text-ink capitalize">
          {formatMonthYear(month, uiLocale)}
        </span>
        <NavButton label={t("nextMonth")} onClick={() => onMonthChange(addMonths(month, 1))}>
          <ChevronRightIcon className="size-4" />
        </NavButton>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {days.slice(0, 7).map((day) => (
          <span key={day.toISOString()} className="micro-label py-1 tracking-normal">
            {formatWeekdayShort(day, uiLocale)}
          </span>
        ))}
        {days.map((day) => {
          const isSelected = selected !== null && isSameDay(day, selected);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onChange(localToIsoDate(day))}
              aria-pressed={isSelected}
              aria-label={formatCalendarDate(localToIsoDate(day), settings)}
              className={cn(
                "grid h-11 place-items-center rounded-lg text-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet/50 mouse:h-10",
                isSameMonth(day, month) ? "text-ink-soft" : "text-ink-muted/50",
                "hover:bg-surface-hover hover:text-ink",
                isSameDay(day, today) && "font-semibold text-teal",
                isSelected && "bg-violet font-semibold text-white hover:bg-violet",
              )}
            >
              {formatDayOfMonth(day, settings)}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-line pt-2">
        <FooterButton onClick={() => onChange(localToIsoDate(today))}>{t("today")}</FooterButton>
        {value && <FooterButton onClick={() => onChange(null)}>{t("clear")}</FooterButton>}
      </div>
    </>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-lg text-ink-soft transition-colors outline-none mouse:size-10 hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-violet/50"
    >
      {children}
    </button>
  );
}

function FooterButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 rounded-lg px-3 text-sm font-medium text-violet transition-colors outline-none mouse:h-10 hover:bg-violet/10 focus-visible:ring-2 focus-visible:ring-violet/50"
    >
      {children}
    </button>
  );
}

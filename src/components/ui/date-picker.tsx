"use client";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  addDays,
  addMonths,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  DEFAULT_FORMAT_SETTINGS,
  formatCalendarDate,
  formatMonthYear,
  formatWeekdayShort,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  type FormatSettings,
  type IsoDate,
} from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const uiLocale = useLocale();
  const selected = value ? isoDateToLocal(value) : null;
  const today = isoDateToLocal(todayIsoDate(settings));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(selected ?? today));

  const gridStart = startOfWeek(month, { weekStartsOn: settings.weekStartsOn });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  function handleOpenChange(next: boolean) {
    if (next) setMonth(startOfMonth(selected ?? today));
    setOpen(next);
  }

  function pick(day: Date) {
    onValueChange(localToIsoDate(day));
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
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
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup
            className={cn(
              "w-76 origin-(--transform-origin) rounded-2xl border border-line-strong bg-surface p-3 shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <NavButton label={t("previousMonth")} onClick={() => setMonth(addMonths(month, -1))}>
                <ChevronLeftIcon className="size-4" />
              </NavButton>
              <Popover.Title className="text-sm font-semibold text-ink capitalize">
                {formatMonthYear(month, uiLocale)}
              </Popover.Title>
              <NavButton label={t("nextMonth")} onClick={() => setMonth(addMonths(month, 1))}>
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
                    onClick={() => pick(day)}
                    aria-pressed={isSelected}
                    aria-label={formatCalendarDate(localToIsoDate(day), settings)}
                    className={cn(
                      "grid h-10 place-items-center rounded-lg text-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet/50",
                      isSameMonth(day, month) ? "text-ink-soft" : "text-ink-muted/50",
                      "hover:bg-surface-hover hover:text-ink",
                      isSameDay(day, today) && "font-semibold text-teal",
                      isSelected && "bg-violet font-semibold text-white hover:bg-violet",
                    )}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between border-t border-line pt-2">
              <FooterButton onClick={() => pick(today)}>{t("today")}</FooterButton>
              {value && (
                <FooterButton
                  onClick={() => {
                    onValueChange(null);
                    setOpen(false);
                  }}
                >
                  {t("clear")}
                </FooterButton>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
      className="grid size-10 place-items-center rounded-lg text-ink-soft transition-colors outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-violet/50"
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
      className="h-10 rounded-lg px-3 text-sm font-medium text-violet transition-colors outline-none hover:bg-violet/10 focus-visible:ring-2 focus-visible:ring-violet/50"
    >
      {children}
    </button>
  );
}

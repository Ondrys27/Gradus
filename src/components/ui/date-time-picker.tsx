"use client";

import { useMemo } from "react";
import {
  formatIsoTime,
  instantToZonedParts,
  zonedWallClockToInstant,
  type IsoTime,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/** Offered clock times, every quarter of an hour. */
const STEP_MINUTES = 15;
/** Time used when only a day is picked. */
const DEFAULT_TIME = "09:00";

const QUARTERS: IsoTime[] = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, index) => {
  const minutes = index * STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

type DateTimePickerProps = {
  /** ISO instant (UTC) or null. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  id?: string;
  datePlaceholder?: string;
  timeLabel: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
};

/**
 * A day and a clock time in the user's zone, stored as one instant. The time
 * list is in the user's time format; a time off the quarter-hour grid (e.g. "now")
 * stays selectable.
 */
export function DateTimePicker({
  value,
  onValueChange,
  id,
  datePlaceholder,
  timeLabel,
  invalid,
  describedBy,
  className,
}: DateTimePickerProps) {
  const settings = useFormatSettings();
  const parts = value ? instantToZonedParts(new Date(value), settings.timeZone) : null;

  const times = useMemo(() => {
    const list =
      parts && !QUARTERS.includes(parts.time) ? [...QUARTERS, parts.time].sort() : QUARTERS;
    return list.map((time) => ({ value: time, label: formatIsoTime(time, settings) }));
  }, [parts, settings]);

  function change(date: string | null, time: IsoTime) {
    onValueChange(
      date ? zonedWallClockToInstant(date, time, settings.timeZone).toISOString() : null,
    );
  }

  return (
    <div
      className={cn("grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2", className)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <DatePicker
        id={id}
        value={parts?.date ?? null}
        placeholder={datePlaceholder}
        onValueChange={(date) => change(date, parts?.time ?? DEFAULT_TIME)}
      />
      <Select
        value={parts?.time ?? null}
        items={times}
        disabled={!parts}
        onValueChange={(time) => {
          if (parts && time) change(parts.date, time);
        }}
      >
        <SelectTrigger aria-label={timeLabel}>
          <SelectValue placeholder={formatIsoTime(DEFAULT_TIME, settings)} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {times.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { formatDayOfMonth, type FormatSettings } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  date: Date;
  isToday: boolean;
  settings: FormatSettings;
  className?: string;
};

/** The day of the month; today is a filled violet circle. */
export function DayNumber({ date, isToday, settings, className }: Props) {
  return (
    <span
      className={cn(
        "grid size-7 place-items-center rounded-full text-sm font-semibold tabular-nums",
        isToday ? "bg-violet text-white shadow-glow" : "text-ink",
        className,
      )}
    >
      {formatDayOfMonth(date, settings)}
    </span>
  );
}

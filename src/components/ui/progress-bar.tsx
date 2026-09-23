import { cn } from "@/lib/utils";

type ProgressBarProps = {
  value: number;
  max?: number;
  /** Accessible name; the bar has no visible text of its own. */
  label: string;
  tone?: "progress" | "reward" | "danger";
  size?: "sm" | "md";
  className?: string;
};

const fills = {
  progress: "bg-linear-to-r from-violet to-teal",
  reward: "bg-linear-to-r from-gold/80 to-gold",
  danger: "bg-pink",
} as const;

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "progress",
  size = "md",
  className,
}: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-line/60",
        size === "sm" ? "h-1.5" : "h-2.5",
        className,
      )}
    >
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out",
          fills[tone],
        )}
        style={{ width: `${ratio * 100}%` }}
      >
        {ratio > 0 && (
          <span className="absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-linear-to-r from-transparent via-white/45 to-transparent motion-reduce:hidden" />
        )}
      </div>
    </div>
  );
}

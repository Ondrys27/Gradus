import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneText, type Tone } from "./tone";

type ProgressRingProps = {
  value: number;
  max?: number;
  label: string;
  /** Diameter in px. */
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  /** Rendered in the centre, e.g. a percentage. */
  children?: ReactNode;
  className?: string;
};

export function ProgressRing({
  value,
  max = 100,
  label,
  size = 96,
  strokeWidth = 8,
  tone = "teal",
  children,
  className,
}: ProgressRingProps) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-line/60"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn(
            "drop-shadow-[0_0_6px_currentColor] transition-[stroke-dashoffset] duration-700 ease-out",
            toneText[tone],
          )}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 grid place-items-center text-center font-semibold text-ink">
          {children}
        </div>
      )}
    </div>
  );
}

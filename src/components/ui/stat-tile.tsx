import type { ReactNode } from "react";
import type { NumberFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { GlowCard } from "./glow-card";
import { toneSoft, type Tone } from "./tone";

type StatTileProps = {
  label: string;
  value: number;
  format?: NumberFormat;
  icon?: ReactNode;
  tone?: Tone;
  /** Small line under the number, e.g. a comparison with last week. */
  hint?: ReactNode;
  className?: string;
};

export function StatTile({
  label,
  value,
  format,
  icon,
  tone = "violet",
  hint,
  className,
}: StatTileProps) {
  return (
    <GlowCard className={cn("@container flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="micro-label">{label}</span>
        {icon && (
          <span
            className={cn(
              "grid size-9 place-items-center rounded-xl border [&_svg]:size-4.5",
              toneSoft[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>
      {/* Shrinks with the tile so long amounts never overflow a narrow column. */}
      <AnimatedNumber
        value={value}
        format={format}
        className="stat-number text-[clamp(24px,17cqi,40px)] whitespace-nowrap text-ink"
      />
      {hint && <div className="text-sm text-ink-muted">{hint}</div>}
    </GlowCard>
  );
}

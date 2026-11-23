"use client";

import type { ReactNode } from "react";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Direction } from "./dashboard-logic";

const TREND_ICON = { up: TrendingUpIcon, down: TrendingDownIcon, same: MinusIcon } as const;
const TREND_TONE: Record<Direction, string> = {
  up: "text-green",
  down: "text-pink",
  same: "text-ink-muted",
};

/** A change against the period before: an icon and words, so colour is never the only signal. */
export function Trend({ direction, children }: { direction: Direction; children: ReactNode }) {
  const Icon = TREND_ICON[direction];
  return (
    <p className={cn("flex items-center gap-1.5 text-sm", TREND_TONE[direction])}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

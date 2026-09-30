"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toneSoft, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import type { Direction } from "./dashboard-logic";

type Props = {
  label: string;
  icon: ReactNode;
  tone: Tone;
  /** Shared with the tile's detail window, so it can grow straight out of this card. */
  layoutId: string;
  onOpen: () => void;
  children: ReactNode;
};

/**
 * A tile that opens its detail on a tap. The button covers the whole card, so the
 * card reads as one target without nesting anything interactive inside it. The card
 * itself carries the shared `layoutId` that the opened detail window grows out of.
 */
export function DashboardTile({ label, icon, tone, layoutId, onOpen, children }: Props) {
  const t = useTranslations("dashboard.tiles");
  return (
    <motion.div
      layoutId={layoutId}
      className="@container relative flex h-full min-h-40 flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-glow transition-[translate,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-hover hover:shadow-glow-strong motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="micro-label">{label}</span>
        <span
          className={cn(
            "grid size-9 place-items-center rounded-xl border [&_svg]:size-4.5",
            toneSoft[tone],
          )}
        >
          {icon}
        </span>
      </div>
      {children}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t("open", { label })}
        onClick={onOpen}
        className="absolute inset-0 cursor-pointer rounded-card outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
      />
    </motion.div>
  );
}

/** The big number of a tile; it shrinks with the tile so long amounts never overflow. */
export function TileNumber({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "stat-number text-[clamp(24px,17cqi,40px)] whitespace-nowrap text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

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

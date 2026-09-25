"use client";

import { HandshakeIcon, ListChecksIcon } from "lucide-react";
import type { Tone } from "@/components/ui/tone";
import { formatTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "./types";

/** Static class maps so Tailwind can see every class name. */
export const blockTone: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-hover text-ink",
  violet: "border-violet/60 bg-violet/25 text-ink",
  teal: "border-teal/60 bg-teal/20 text-ink",
  gold: "border-gold/60 bg-gold/20 text-ink",
  green: "border-green/60 bg-green/20 text-ink",
  pink: "border-pink/60 bg-pink/20 text-ink",
};

/** Mirrored items are outlined, not filled, so they never pass for the user's own events. */
export const mirrorTone: Record<Tone, string> = {
  neutral: "border-dashed border-line-strong text-ink-soft",
  violet: "border-dashed border-violet/60 text-violet",
  teal: "border-dashed border-teal/60 text-teal",
  gold: "border-dashed border-gold/60 text-gold",
  green: "border-dashed border-green/60 text-green",
  pink: "border-dashed border-pink/60 text-pink",
};

export function itemClass(item: CalendarItem): string {
  return item.type === "mirror" ? mirrorTone[item.tone] : blockTone[item.tone];
}

export function MirrorIcon({ item, className }: { item: CalendarItem; className?: string }) {
  if (item.type !== "mirror") return null;
  const Icon = item.mirror.source === "task" ? ListChecksIcon : HandshakeIcon;
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />;
}

type Props = {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  /** Show the start time before the title (timed events). */
  showTime?: boolean;
  className?: string;
};

/** A one-line bar for an item: month cells and the all-day row. */
export function ItemChip({ item, onOpen, showTime, className }: Props) {
  const settings = useFormatSettings();
  const time =
    showTime && item.type === "event" && !item.allDay
      ? formatTime(new Date(item.startMs), settings)
      : null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      className={cn(
        "flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-left text-xs leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        itemClass(item),
        className,
      )}
    >
      <MirrorIcon item={item} />
      {time && <span className="shrink-0 tabular-nums opacity-80">{time}</span>}
      <span className="truncate font-medium">{item.title}</span>
    </button>
  );
}

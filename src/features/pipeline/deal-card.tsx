"use client";

import type { KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CalendarIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { contactLabel } from "./board-logic";
import type { Deal } from "./types";

type BodyProps = {
  deal: Deal;
  relaunchable: boolean;
  /** Cards of a lost stage are dimmed. */
  muted: boolean;
  className?: string;
};

/** What a card shows: title, amount, contact avatar and date. Also drawn inside the drag overlay. */
export function DealCardBody({ deal, relaunchable, muted, className }: BodyProps) {
  const t = useTranslations("pipeline.card");
  const settings = useFormatSettings();
  const contact = contactLabel(deal.contact);

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 text-left transition-colors",
        muted && "opacity-60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold break-words text-ink">{deal.title}</span>
        {deal.value !== null && (
          <span className="shrink-0 text-sm font-semibold text-ink-soft tabular-nums">
            {formatCurrency(Number(deal.value), deal.currency, settings)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Avatar name={contact} className="size-6 text-[10px]" />
        <span className="min-w-0 flex-1 truncate">{contact || t("noContact")}</span>
        {deal.expected_close_date && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <CalendarIcon aria-hidden className="size-3.5" />
            {formatCalendarDate(deal.expected_close_date, settings)}
          </span>
        )}
      </div>
      {relaunchable && (
        <StatusPill tone="gold" className="self-start">
          <RotateCcwIcon aria-hidden />
          {t("relaunch")}
        </StatusPill>
      )}
    </div>
  );
}

type CardProps = BodyProps & {
  /** Off on phones and while editing stages: a card is then only opened. */
  draggable: boolean;
  onOpen: (deal: Deal) => void;
};

export function DealCard({ deal, relaunchable, muted, draggable, onOpen }: CardProps) {
  const t = useTranslations("pipeline.card");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !draggable,
    data: { type: "deal", deal },
  });

  // Space belongs to the keyboard drag; Enter opens the deal.
  function handleKeyDown(event: KeyboardEvent) {
    listeners?.onKeyDown?.(event);
    if (event.key === "Enter" && !event.defaultPrevented) onOpen(deal);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
      onClick={() => onOpen(deal)}
      aria-label={t("open", { title: deal.title })}
      className={cn(
        "cursor-pointer rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
        draggable && "mouse:cursor-grab",
        isDragging && "opacity-30",
      )}
    >
      <DealCardBody
        deal={deal}
        relaunchable={relaunchable}
        muted={muted}
        className="hover:border-line-strong"
      />
    </div>
  );
}

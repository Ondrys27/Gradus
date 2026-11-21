"use client";

import type { KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CalendarIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/features/account/workspace-queries";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { DemoBadge } from "@/features/tutorial/demo-badge";
import { contactLabel } from "./board-logic";
import { dealAssigneeIds } from "./assignees";
import { PeopleFaces, usePeopleLabel } from "./deal-people";
import { useAssignees } from "@/features/crm-tasks/queries";
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
  const seeAmounts = useCan("pipeline", "see_amounts");
  const peopleLabel = usePeopleLabel();
  const contact = contactLabel(deal.contact);
  // Who works on it, once the space has more than one person.
  const team = (useAssignees().data?.length ?? 0) > 1;
  const people = dealAssigneeIds(deal);

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 text-left transition-colors",
        muted && "opacity-60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold break-words text-ink">
          {deal.title}
          <DemoBadge show={deal.is_demo} className="ml-1.5 align-middle" />
        </span>
        {seeAmounts && deal.value !== null && (
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
        {team && people.length > 0 && (
          <>
            <PeopleFaces ids={people} />
            <span className="sr-only">{t("people", { people: peopleLabel(people) })}</span>
          </>
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
      // Only dragging may be off; the card always opens the deal.
      aria-disabled={undefined}
      {...listeners}
      onKeyDown={handleKeyDown}
      onClick={() => onOpen(deal)}
      data-tutorial="deal-card"
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

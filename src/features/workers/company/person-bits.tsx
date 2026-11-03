"use client";

import { ListChecksIcon, SquareKanbanIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { toneFill, toneSoft } from "@/components/ui/tone";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { WorkerStatus } from "../types";
import type { CompanyGroup } from "./tree";

const STATUS_TONE = { active: "green", invited: "violet", inactive: "neutral" } as const;

/** Active, invited (waiting to sign up) or ended. */
export function PersonStatus({ status }: { status: WorkerStatus }) {
  const t = useTranslations("workers.company.status");
  return (
    <StatusPill tone={STATUS_TONE[status]} dot={status === "active"}>
      {t(status)}
    </StatusPill>
  );
}

/** The person's groups as small labels in each group's colour. */
export function GroupChips({
  groupIds,
  groups,
  max = 3,
  className,
}: {
  groupIds: readonly string[];
  groups: ReadonlyMap<string, CompanyGroup>;
  max?: number;
  className?: string;
}) {
  const settings = useFormatSettings();
  const known = groupIds.flatMap((id) => {
    const group = groups.get(id);
    return group ? [group] : [];
  });
  if (known.length === 0) return null;
  const shown = known.slice(0, max);
  const more = known.length - shown.length;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((group) => (
        <span
          key={group.id}
          data-testid="group-chip"
          className={cn(
            "inline-flex h-5 max-w-36 items-center gap-1 truncate rounded-full border px-2 text-[11px] font-semibold",
            toneSoft[group.color],
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", toneFill[group.color])}
          />
          <span className="truncate">{group.name}</span>
        </span>
      ))}
      {more > 0 && (
        <span className="text-[11px] font-semibold text-ink-muted">
          +{formatNumber(more, {}, settings)}
        </span>
      )}
    </span>
  );
}

/** Open tasks and deals in the person's care, as two quiet numbers. */
export function PersonCounts({
  openTasks,
  openDeals,
  className,
}: {
  openTasks: number;
  openDeals: number;
  className?: string;
}) {
  const t = useTranslations("workers.company");
  const settings = useFormatSettings();
  const items = [
    { key: "tasks", icon: ListChecksIcon, count: openTasks, label: "openTasks" },
    { key: "deals", icon: SquareKanbanIcon, count: openDeals, label: "openDeals" },
  ] as const;
  return (
    <span className={cn("flex items-center gap-3 text-xs text-ink-muted tabular-nums", className)}>
      {items.map(({ key, icon: Icon, count, label }) => {
        const text = t(label, { count, shown: formatNumber(count, {}, settings) });
        return (
          <span key={key} className="flex items-center gap-1" title={text}>
            <Icon aria-hidden className="size-3.5" />
            <span aria-hidden>{formatNumber(count, {}, settings)}</span>
            <span className="sr-only">{text}</span>
          </span>
        );
      })}
    </span>
  );
}

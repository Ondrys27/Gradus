"use client";

import { useTranslations } from "next-intl";
import { toneFill, toneSoft } from "@/components/ui/tone";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { tableTone, type ContactTable } from "./types";

type Props = {
  tables: ContactTable[];
  counts: Map<string, number> | undefined;
  /** null = All */
  value: string | null;
  onChange: (tableId: string | null) => void;
  /** "All" as the first chip; off where one table is always picked. */
  showAll?: boolean;
};

/**
 * One chip per table with its count, "All" first. On phones the row scrolls
 * sideways inside itself, bleeding to the screen edge; the page never does.
 */
export function TableSwitcher({ tables, counts, value, onChange, showAll = true }: Props) {
  const t = useTranslations("contacts.tables");
  const settings = useFormatSettings();
  const total = counts ? [...counts.values()].reduce((sum, count) => sum + count, 0) : undefined;

  function chip(id: string | null, label: string, count: number | undefined, color: string) {
    const tone = id === null ? "violet" : tableTone(color);
    const selected = value === id;
    return (
      <button
        key={id ?? "all"}
        type="button"
        aria-pressed={selected}
        onClick={() => onChange(id)}
        className={cn(
          "inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9",
          selected
            ? toneSoft[tone]
            : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
        )}
      >
        {id !== null && <span aria-hidden className={cn("size-2 rounded-full", toneFill[tone])} />}
        {label}
        {count !== undefined && (
          <span
            className={cn(
              "rounded-full px-1.5 text-xs tabular-nums",
              selected ? "bg-canvas/40" : "bg-surface-hover text-ink-muted",
            )}
          >
            {formatNumber(count, {}, settings)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="-mx-4 flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      {showAll && chip(null, t("all"), total, "violet")}
      {tables.map((table) =>
        chip(table.id, table.name, counts ? (counts.get(table.id) ?? 0) : undefined, table.color),
      )}
    </div>
  );
}

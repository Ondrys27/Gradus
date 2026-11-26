"use client";

import { EyeIcon, PencilIcon, TimerIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SHARE_LEVELS, type ShareLevel } from "../levels";

const LEVEL_ICON = { busy: TimerIcon, read: EyeIcon, write: PencilIcon } as const;

/** The three levels as radio cards with what each one means. */
export function LevelChoice({
  name,
  value,
  onChange,
  levels = SHARE_LEVELS,
}: {
  name: string;
  value: ShareLevel;
  onChange: (level: ShareLevel) => void;
  levels?: readonly ShareLevel[];
}) {
  const t = useTranslations("calendar.sharing.levels");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink-soft">{t("label")}</legend>
      {levels.map((level) => {
        const Icon = LEVEL_ICON[level];
        const selected = value === level;
        return (
          <label
            key={level}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
              selected ? "border-teal/60 bg-teal/10" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name={name}
              value={level}
              checked={selected}
              onChange={() => onChange(level)}
              className="mt-0.5 size-4 accent-teal"
              data-testid={`${name}-${level}`}
            />
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-soft" />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-ink">{t(level)}</span>
              <span className="text-xs text-ink-muted">{t(`${level}Hint`)}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

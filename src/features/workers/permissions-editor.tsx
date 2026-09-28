"use client";

import { useTranslations } from "next-intl";
import { PERMISSION_SECTIONS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";
import { ACCESS_LEVELS, type PermissionDraft } from "./logic";

type Props = {
  value: PermissionDraft;
  onChange: (value: PermissionDraft) => void;
};

/**
 * Per section: nothing, see, or edit. Dashboard, tasks, rewards and calendar
 * are always the worker's own and are not listed.
 */
export function PermissionsEditor({ value, onChange }: Props) {
  const t = useTranslations("workers.permissions");
  const tNav = useTranslations("nav");

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-ink">{t("title")}</legend>
      <p className="-mt-1 text-xs text-ink-muted">{t("hint")}</p>
      <ul className="flex flex-col gap-2">
        {PERMISSION_SECTIONS.map(({ key, section }) => (
          <li
            key={section}
            className="flex flex-col gap-2 rounded-xl border border-line bg-canvas-deep/40 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span id={`permission-${section}`} className="text-sm font-medium text-ink">
              {tNav(key)}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`permission-${section}`}
              className="grid grid-cols-3 rounded-full border border-line p-0.5 sm:w-72"
            >
              {ACCESS_LEVELS.map((level) => {
                const selected = value[section] === level;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ ...value, [section]: level })}
                    className={cn(
                      "h-11 cursor-pointer rounded-full px-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
                      selected
                        ? level === "none"
                          ? "bg-surface-hover text-ink"
                          : "bg-violet/20 text-ink"
                        : "text-ink-soft hover:text-ink",
                    )}
                  >
                    {t(`level.${level}`)}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

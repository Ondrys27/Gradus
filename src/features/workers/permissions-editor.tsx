"use client";

import { useTranslations } from "next-intl";
import { PERMISSION_SECTIONS } from "@/components/layout/nav-items";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  PERMISSION_PRESETS,
  presetOf,
  presetPermissions,
  toggleAccess,
  type PermissionDraft,
  type PermissionPreset,
} from "./logic";

type Props = {
  value: PermissionDraft;
  onChange: (value: PermissionDraft) => void;
  disabled?: boolean;
  /** Shown under the title, e.g. that a change applies at once. */
  hint?: string;
};

/**
 * What the worker may do in the owner's space: one row per section, switches
 * for "sees" and "edits". A role fills the matrix and can then be adjusted;
 * any adjustment reads as "custom". Dashboard, tasks and rewards are always
 * the worker's own; workers and settings are never open to them.
 */
export function PermissionsEditor({ value, onChange, disabled, hint }: Props) {
  const t = useTranslations("workers.permissions");
  const tNav = useTranslations("nav");
  const preset = presetOf(value);
  const options: (PermissionPreset | "custom")[] = [...PERMISSION_PRESETS, "custom"];

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-ink">{t("title")}</legend>
      <p className="-mt-1 text-xs text-ink-muted">{hint ?? t("hint")}</p>

      <div role="radiogroup" aria-label={t("presets.label")} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = preset === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || (option === "custom" && !selected)}
              onClick={() => option !== "custom" && onChange(presetPermissions(option))}
              className={cn(
                "h-11 cursor-pointer rounded-full border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-default mouse:h-8",
                selected
                  ? "border-violet/50 bg-violet/20 text-ink"
                  : "border-line text-ink-soft hover:text-ink disabled:opacity-50 disabled:hover:text-ink-soft",
              )}
            >
              {t(`presets.${option}`)}
            </button>
          );
        })}
      </div>

      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className="pb-2 text-left text-xs font-medium text-ink-muted">
              {t("section")}
            </th>
            <th scope="col" className="w-20 pb-2 text-center text-xs font-medium text-ink-muted">
              {t("view")}
            </th>
            <th scope="col" className="w-20 pb-2 text-center text-xs font-medium text-ink-muted">
              {t("edit")}
            </th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_SECTIONS.map(({ key, section }) => {
            const level = value[section];
            const name = tNav(key);
            return (
              <tr key={section}>
                <th
                  scope="row"
                  className="border-t border-line py-2.5 pr-2 text-left font-medium text-ink"
                >
                  {name}
                  {section === "finance" && (
                    <span className="block text-xs font-normal text-ink-muted">
                      {t("financeHint")}
                    </span>
                  )}
                </th>
                <td className="border-t border-line py-2.5 text-center">
                  <Switch
                    aria-label={t("viewSection", { section: name })}
                    checked={level !== "none"}
                    disabled={disabled}
                    onCheckedChange={(on) => onChange(toggleAccess(value, section, "view", on))}
                  />
                </td>
                <td className="border-t border-line py-2.5 text-center">
                  <Switch
                    aria-label={t("editSection", { section: name })}
                    checked={level === "edit"}
                    disabled={disabled}
                    onCheckedChange={(on) => onChange(toggleAccess(value, section, "edit", on))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import type { WidgetSettings } from "./kit";
import { settingValue, type CoreWidgetMeta as WidgetMeta, type WidgetSetting } from "./meta";
import type { WidgetSystem } from "./system";

/**
 * The gear of a widget in editing: its settings from the catalog's schema
 * (a choice, several of a list, or a kind of the system's own such as one
 * of the person's notes). Only what the account may pick is offered.
 */
export function WidgetSettingsDialog({
  meta,
  name,
  settings,
  system,
  onSave,
  onClose,
}: {
  meta: WidgetMeta;
  name: string;
  settings: WidgetSettings;
  system: WidgetSystem;
  onSave: (settings: WidgetSettings) => void;
  onClose: () => void;
}) {
  const t = useTranslations("dashboard.board");
  const [draft, setDraft] = useState<WidgetSettings>(() =>
    Object.fromEntries(
      meta.settings.map((setting) => [setting.key, settingValue(meta, setting.key, settings)]),
    ),
  );
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settingsTitle", { name })}
      closeLabel={t("close")}
    >
      <form
        className="flex flex-col gap-5"
        data-testid="widget-settings-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        {meta.settings.map((setting) => (
          <SettingField
            key={setting.key}
            widget={meta.key}
            setting={setting}
            value={draft[setting.key]}
            system={system}
            onChange={(value) => setDraft((previous) => ({ ...previous, [setting.key]: value }))}
          />
        ))}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" data-testid="widget-settings-save">
            {t("save")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

function SettingField({
  widget,
  setting,
  value,
  system,
  onChange,
}: {
  widget: string;
  setting: WidgetSetting;
  value: unknown;
  system: WidgetSystem;
  onChange: (value: unknown) => void;
}) {
  const tBoard = useTranslations("dashboard.board");
  const label = (part: string) => system.settingLabel(widget, setting.key, part);

  if (setting.kind === "choice") {
    const options = system.choiceOptions(setting);
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{label("label")}</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={value === option}
              onClick={() => onChange(option)}
              data-testid={`widget-setting-${setting.key}-${option}`}
              className={cn(
                "min-h-11 rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                value === option
                  ? "border-violet bg-violet/20 text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              {label(option)}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  if (setting.kind === "multi") {
    const allowed = system.multiOptions(widget, setting);
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const options = setting.options.filter((option) => allowed.includes(option));
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{label("label")}</legend>
        <ul className="grid gap-1 sm:grid-cols-2">
          {options.map((option) => {
            const checked = selected.includes(option);
            const blocked =
              (!checked && selected.length >= setting.max) ||
              (checked && selected.length <= setting.min);
            return (
              <li key={option}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-ink mouse:min-h-9">
                  <Checkbox
                    checked={checked}
                    disabled={blocked}
                    onCheckedChange={(next) =>
                      onChange(
                        next
                          ? setting.options.filter(
                              (key) => key === option || selected.includes(key),
                            )
                          : selected.filter((key) => key !== option),
                      )
                    }
                  />
                  {system.multiOptionLabel(widget, setting, option)}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-ink-muted">
          {tBoard("multiHint", { min: setting.min, max: setting.max })}
        </p>
      </fieldset>
    );
  }

  const Custom = system.CustomSetting;
  if (!Custom) return null;
  return (
    <Custom widget={widget} setting={setting} label={label("label")} value={value} onChange={onChange} />
  );
}

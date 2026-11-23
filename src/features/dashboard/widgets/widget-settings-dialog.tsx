"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useNotes } from "@/features/notes/queries";
import { cn } from "@/lib/utils";
import { allowedOptions, allowedQuickActions, type WidgetAccess } from "./access";
import { settingValue, type WidgetMeta, type WidgetSetting } from "./catalog";
import type { WidgetSettings } from "./kit";

/**
 * The gear of a widget in editing: its settings from the catalog's schema
 * (a choice, several of a list, one of the person's notes). Only what the
 * account may pick is offered.
 */
export function WidgetSettingsDialog({
  meta,
  name,
  settings,
  access,
  onSave,
  onClose,
}: {
  meta: WidgetMeta;
  name: string;
  settings: WidgetSettings;
  access: WidgetAccess;
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
            access={access}
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
  access,
  onChange,
}: {
  widget: string;
  setting: WidgetSetting;
  value: unknown;
  access: WidgetAccess;
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations("dashboard.widgets");
  const tBoard = useTranslations("dashboard.board");
  const label = (key: string) => t(`${widget}.settings.${setting.key}.${key}` as "today.name");

  if (setting.kind === "choice") {
    const options = allowedOptions(setting, access);
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
    const allowed =
      widget === "quickActions" ? (allowedQuickActions(access) as string[]) : setting.options;
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
                  {t(`quickActions.actions.${option}` as "today.name")}
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

  return (
    <NoteField
      label={label("label")}
      value={typeof value === "string" ? value : null}
      onChange={onChange}
    />
  );
}

function NoteField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations("dashboard.widgets.pinnedNote");
  const notes = useNotes();
  const pinned = (notes.data ?? []).filter((note) => note.pinned || note.id === value);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{label}</legend>
      <ul className="flex flex-col gap-1">
        {[
          { id: null, title: t("settings.note.auto") },
          ...pinned.map((note) => ({ id: note.id, title: note.title || t("untitled") })),
        ].map((option) => (
          <li key={option.id ?? "auto"}>
            <button
              type="button"
              aria-pressed={value === option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                "flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                value === option.id
                  ? "border-violet bg-violet/20 text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              <span className="truncate">{option.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {pinned.length === 0 && <p className="text-xs text-ink-muted">{t("settings.note.none")}</p>}
    </fieldset>
  );
}

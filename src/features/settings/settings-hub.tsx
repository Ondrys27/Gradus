"use client";

import { useTranslations } from "next-intl";
import { SettingsGroupList } from "./settings-shell";
import { useVisibleSettings } from "./use-visible-settings";

/**
 * Settings itself, on a computer: the groups with a sentence each, next to
 * the menu. On a phone the menu is this list, so the shell hides this.
 */
export function SettingsHub() {
  const t = useTranslations("settings");
  const { groups } = useVisibleSettings();
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">{t("title")}</h1>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </header>
      <SettingsGroupList groups={groups} />
    </div>
  );
}

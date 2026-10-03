"use client";

import { useMemo } from "react";
import { CheckIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUserSettings } from "@/features/account/queries";
import { useDefinitions } from "@/features/game/overview-queries";
import { APP_NAME } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import {
  effectiveTheme,
  isThemeAvailable,
  themeUnlockKey,
  THEMES,
  type ThemeKey,
} from "@/lib/themes";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { UserSettingsPatch } from "@/lib/user-settings";
import { cn } from "@/lib/utils";
import { useThemeAccess } from "./theme";

/**
 * Settings → Appearance: a live preview of every theme. In game mode a theme
 * opens with its level; in tool mode all of them are open.
 */
export function AppearanceSettings({ save }: { save: (patch: UserSettingsPatch) => void }) {
  const t = useTranslations("settings.appearance");
  const settings = useUserSettings();
  const format = useFormatSettings();
  const access = useThemeAccess();
  const definitions = useDefinitions();
  const current = effectiveTheme(settings.theme, access ?? { locked: false, unlocked: [] });

  const levels = useMemo(() => {
    const map = new Map<string, number>();
    for (const [level, items] of definitions.data?.levelRewards ?? []) {
      for (const item of items) map.set(item.key, level);
    }
    return map;
  }, [definitions.data]);

  return (
    <div
      id="settings-theme"
      tabIndex={-1}
      role="radiogroup"
      aria-label={t("title")}
      className="grid grid-cols-2 gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:grid-cols-3"
    >
      {THEMES.map((theme) => {
        const available = access ? isThemeAvailable(theme, access) : theme === "gradus";
        const checked = current === theme;
        const level = levels.get(themeUnlockKey(theme));
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={!available}
            onClick={() => {
              if (available && !checked) save({ theme });
            }}
            className={cn(
              "flex flex-col gap-2 rounded-2xl border p-2 text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50",
              checked ? "border-violet shadow-glow-strong" : "border-line",
              available ? "cursor-pointer hover:border-line-strong" : "cursor-not-allowed",
            )}
          >
            <ThemePreview theme={theme} dimmed={!available} />
            <span className="flex min-h-8 items-center justify-between gap-2 px-1">
              <span className="text-sm font-semibold text-ink">{t(`themes.${theme}`, { appName: APP_NAME })}</span>
              {checked ? (
                <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />
              ) : !available ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                  <LockIcon aria-hidden className="size-3.5" />
                  {level ? t("level", { level: formatNumber(level, {}, format) }) : t("locked")}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A miniature of the app painted with the theme's own tokens. */
function ThemePreview({ theme, dimmed }: { theme: ThemeKey; dimmed: boolean }) {
  return (
    <span
      data-theme={theme}
      aria-hidden
      className={cn(
        "relative flex aspect-[4/3] w-full flex-col gap-1.5 overflow-hidden rounded-xl border border-line bg-canvas p-2",
        dimmed && "opacity-45 grayscale-[40%]",
      )}
    >
      <span className="absolute -bottom-6 -left-6 size-16 rounded-full bg-violet opacity-40 blur-xl" />
      <span className="absolute -top-6 -right-6 size-14 rounded-full bg-teal opacity-35 blur-xl" />
      <span className="relative flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] bg-linear-to-br from-violet to-teal" />
        <span className="h-1.5 w-10 rounded-full bg-ink-muted/60" />
      </span>
      <span className="relative flex flex-1 flex-col gap-1.5 rounded-lg border border-line bg-surface p-1.5">
        <span className="h-1.5 w-3/4 rounded-full bg-ink" />
        <span className="h-1.5 w-1/2 rounded-full bg-ink-soft/70" />
        <span className="mt-auto h-1.5 w-full overflow-hidden rounded-full bg-line">
          <span className="block h-full w-2/3 rounded-full bg-linear-to-r from-violet to-teal" />
        </span>
      </span>
      <span className="relative flex gap-1">
        <span className="h-3 flex-1 rounded-md bg-violet" />
        <span className="h-3 w-4 rounded-md bg-gold" />
      </span>
    </span>
  );
}

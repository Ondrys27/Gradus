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
import { cn } from "@/lib/utils";
import { useSettingsSave } from "./save-state";
import { useThemeAccess } from "./theme";

/**
 * Settings → Appearance: a live preview of every theme. In game mode a theme
 * opens with its level; in tool mode all of them are open.
 */
export function ThemeGrid() {
  const t = useTranslations("settings.appearance");
  const settings = useUserSettings();
  const format = useFormatSettings();
  const { save } = useSettingsSave();
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
      className="grid grid-cols-2 gap-2 rounded-xl outline-none sm:grid-cols-3"
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
              "flex flex-col gap-1.5 rounded-xl border p-1.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
              checked ? "border-violet/60 bg-violet/10" : "border-line",
              available ? "cursor-pointer hover:border-line-strong" : "cursor-not-allowed",
            )}
          >
            <ThemePreview theme={theme} dimmed={!available} />
            <span className="flex min-h-6 items-center justify-between gap-2 px-1">
              <span className="truncate text-[13px] font-medium text-ink">
                {t(`themes.${theme}`, { appName: APP_NAME })}
              </span>
              {checked ? (
                <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />
              ) : !available ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                  <LockIcon aria-hidden className="size-3" />
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
        "relative flex aspect-[5/3] w-full flex-col gap-1 overflow-hidden rounded-lg border border-line bg-canvas p-1.5",
        dimmed && "opacity-45 grayscale-[40%]",
      )}
    >
      <span className="absolute -bottom-6 -left-6 size-14 rounded-full bg-violet opacity-40 blur-xl" />
      <span className="absolute -top-6 -right-6 size-12 rounded-full bg-teal opacity-35 blur-xl" />
      <span className="relative flex items-center gap-1">
        <span className="size-2.5 rounded-[3px] bg-linear-to-br from-violet to-teal" />
        <span className="h-1 w-8 rounded-full bg-ink-muted/60" />
      </span>
      <span className="relative flex flex-1 flex-col gap-1 rounded-md border border-line bg-surface p-1">
        <span className="h-1 w-3/4 rounded-full bg-ink" />
        <span className="h-1 w-1/2 rounded-full bg-ink-soft/70" />
        <span className="mt-auto h-1 w-full overflow-hidden rounded-full bg-line">
          <span className="block h-full w-2/3 rounded-full bg-linear-to-r from-violet to-teal" />
        </span>
      </span>
    </span>
  );
}

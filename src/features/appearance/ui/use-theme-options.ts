"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useDefinitions } from "@/features/game/overview-queries";
import { APP_NAME } from "@/lib/constants";
import { isThemeAvailable, themeUnlockKey, THEMES } from "@/lib/themes";
import { builtinView, customView, type AppearanceView } from "../custom-tokens";
import { useCustomThemes, type CustomTheme } from "../queries";
import { customRef, type ThemeRef } from "../theme-ref";
import { useViewFor } from "../use-appearance";

export type ThemeOption = {
  ref: ThemeRef;
  label: string;
  view: AppearanceView;
  /** False for a built-in theme game mode keeps locked. */
  available: boolean;
  /** The level that opens a locked theme. */
  level: number | null;
  custom: CustomTheme | null;
};

/** Every theme the user may see in a picker: the six built-in ones, then their custom ones. */
export function useThemeOptions(): ThemeOption[] {
  const t = useTranslations("settings.appearance");
  const { access } = useViewFor();
  const customs = useCustomThemes().data;
  const definitions = useDefinitions();
  return useMemo(() => {
    const levels = new Map<string, number>();
    for (const [level, items] of definitions.data?.levelRewards ?? []) {
      for (const item of items) levels.set(item.key, level);
    }
    const builtins: ThemeOption[] = THEMES.map((theme) => ({
      ref: theme,
      label: t(`themes.${theme}`, { appName: APP_NAME }),
      view: builtinView(theme),
      available: access ? isThemeAvailable(theme, access) : theme === "gradus",
      level: levels.get(themeUnlockKey(theme)) ?? null,
      custom: null,
    }));
    const own: ThemeOption[] = (customs ?? []).map((theme) => ({
      ref: customRef(theme.id),
      label: theme.name,
      view: customView(theme.tokens),
      available: true,
      level: null,
      custom: theme,
    }));
    return [...builtins, ...own];
  }, [t, access, customs, definitions.data]);
}

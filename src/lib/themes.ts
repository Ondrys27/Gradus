/**
 * Colour themes. Each one is a set of tokens under `[data-theme="<key>"]` in
 * globals.css; the app sets the attribute on <html>. The choice is stored in
 * user_settings.theme. In game mode a theme other than the default opens with
 * a level (unlock key `theme_<key>`); in tool mode and for a worker every theme
 * is open. The database enforces the same rule (user_settings_theme_guard).
 */

export const THEMES = ["gradus", "midnight", "forest", "sunset", "steel", "light"] as const;
export type ThemeKey = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeKey = "gradus";

/** Read by the root layout so the first paint already has the right colours. */
export const THEME_COOKIE = "theme";

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function themeUnlockKey(theme: ThemeKey): string {
  return `theme_${theme}`;
}

/** Whether a theme may be used: the default always, all of them when nothing is locked. */
export function isThemeAvailable(
  theme: ThemeKey,
  options: { locked: boolean; unlocked: readonly string[] },
): boolean {
  if (theme === DEFAULT_THEME || !options.locked) return true;
  return options.unlocked.includes(themeUnlockKey(theme));
}

/** The theme actually shown: the stored one when it is open, else the default. */
export function effectiveTheme(
  stored: string | null | undefined,
  options: { locked: boolean; unlocked: readonly string[] },
): ThemeKey {
  return isThemeKey(stored) && isThemeAvailable(stored, options) ? stored : DEFAULT_THEME;
}

/** Client side: remembers the shown theme for the next server render. */
export function writeThemeCookie(theme: ThemeKey) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

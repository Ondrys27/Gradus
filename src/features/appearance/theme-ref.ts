import { DEFAULT_THEME, isThemeKey, type ThemeKey } from "@/lib/themes";

/**
 * Which theme: a built-in key (`midnight`) or one of the user's custom
 * themes (`custom:<uuid>`). The schedule stores refs; the manual pick is
 * `user_settings.theme` plus `custom_theme_id`.
 */
export type ThemeRef = ThemeKey | `custom:${string}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ParsedRef = { kind: "builtin"; key: ThemeKey } | { kind: "custom"; id: string };

export function parseThemeRef(value: unknown): ParsedRef | null {
  if (isThemeKey(value)) return { kind: "builtin", key: value };
  if (typeof value !== "string" || !value.startsWith("custom:")) return null;
  const id = value.slice("custom:".length);
  return UUID.test(id) ? { kind: "custom", id } : null;
}

export function isThemeRef(value: unknown): value is ThemeRef {
  return parseThemeRef(value) !== null;
}

export function customRef(id: string): ThemeRef {
  return `custom:${id}`;
}

/** The manual pick of the settings row as a ref. */
export function manualRef(settings: { theme: string; custom_theme_id: string | null }): ThemeRef {
  if (settings.custom_theme_id && UUID.test(settings.custom_theme_id)) return customRef(settings.custom_theme_id);
  return isThemeKey(settings.theme) ? settings.theme : DEFAULT_THEME;
}

/** The settings columns of a manual pick: a custom theme keeps the built-in one underneath. */
export function manualColumns(
  ref: ThemeRef,
  current: { theme: string },
): { theme: ThemeKey; custom_theme_id: string | null } {
  const parsed = parseThemeRef(ref);
  if (parsed?.kind === "custom") {
    return { theme: isThemeKey(current.theme) ? current.theme : DEFAULT_THEME, custom_theme_id: parsed.id };
  }
  return { theme: parsed?.kind === "builtin" ? parsed.key : DEFAULT_THEME, custom_theme_id: null };
}

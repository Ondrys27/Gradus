import type { ThemeKey } from "@/lib/themes";
import { BUILTIN_PALETTES, type Palette } from "./builtin-palettes";
import {
  contrastRatio,
  fromOklch,
  isHex,
  mix,
  normalizeHex,
  readableOn,
  toOklch,
  withContrast,
} from "./color";

/**
 * A custom theme (30.6) is the user's choice of a few colours and options;
 * every CSS variable of the design system (the tokens of @theme) is derived
 * from them here, deterministically. Nothing the user types ever becomes
 * CSS: colours are checked `#rrggbb`, everything else is a code from a list
 * (`public.valid_custom_theme_tokens` checks the same shape).
 */

export const THEME_BASES = ["dark", "light"] as const;
export type ThemeBase = (typeof THEME_BASES)[number];

export const THEME_DENSITIES = ["compact", "comfortable", "spacious"] as const;
export type ThemeDensity = (typeof THEME_DENSITIES)[number];

export const THEME_BACKDROPS = ["solid", "gradient", "glow"] as const;
export type ThemeBackdrop = (typeof THEME_BACKDROPS)[number];

export const THEME_SHADOWS = ["none", "soft", "normal", "strong"] as const;
export type ThemeShadow = (typeof THEME_SHADOWS)[number];

/** The six heading faces (next/font in root-document.tsx, rules in globals.css). */
export const HEADING_FONTS = ["inter", "poppins", "bricolage", "space_grotesk", "fraunces", "sora"] as const;
export type HeadingFont = (typeof HEADING_FONTS)[number];

export const REQUIRED_COLORS = ["canvas", "surface", "ink", "accent", "accent2"] as const;
export const STATUS_COLORS = ["success", "warning", "danger"] as const;
export type ThemeColorKey = (typeof REQUIRED_COLORS)[number] | (typeof STATUS_COLORS)[number];

export const RADIUS_MIN = 0;
export const RADIUS_MAX = 24;
export const DEFAULT_RADIUS = 16;

export type ThemeColors = Record<(typeof REQUIRED_COLORS)[number], string> &
  Partial<Record<(typeof STATUS_COLORS)[number], string>>;

export type CustomThemeTokens = {
  v: 1;
  base: ThemeBase;
  colors: ThemeColors;
  /** Corner radius of cards in px; controls follow at three quarters. */
  radius: number;
  density: ThemeDensity;
  backdrop: ThemeBackdrop;
  headingFont: HeadingFont;
  shadow: ThemeShadow;
};

export const CUSTOM_THEME_NAME_MAX = 40;
export const CUSTOM_THEMES_MAX = 12;

const TOKEN_KEYS = ["v", "base", "colors", "radius", "density", "backdrop", "headingFont", "shadow"];
const COLOR_KEYS: readonly string[] = [...REQUIRED_COLORS, ...STATUS_COLORS];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * The stored shape, strictly: unknown keys, a colour that is not lowercase
 * `#rrggbb` or a code outside its list refuse the whole value. Mirrors
 * `public.valid_custom_theme_tokens()`.
 */
export function parseCustomThemeTokens(raw: unknown): CustomThemeTokens | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !TOKEN_KEYS.includes(key))) return null;
  if (value.v !== 1) return null;
  if (!isOneOf(THEME_BASES, value.base)) return null;
  if (!isOneOf(THEME_DENSITIES, value.density)) return null;
  if (!isOneOf(THEME_BACKDROPS, value.backdrop)) return null;
  if (!isOneOf(HEADING_FONTS, value.headingFont)) return null;
  if (!isOneOf(THEME_SHADOWS, value.shadow)) return null;
  const radius = value.radius;
  if (typeof radius !== "number" || !Number.isInteger(radius) || radius < RADIUS_MIN || radius > RADIUS_MAX) {
    return null;
  }
  const colors = value.colors;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return null;
  const entries = Object.entries(colors as Record<string, unknown>);
  if (entries.some(([key, color]) => !COLOR_KEYS.includes(key) || !isHex(color))) return null;
  if (REQUIRED_COLORS.some((key) => !(key in colors))) return null;
  return {
    v: 1,
    base: value.base,
    colors: { ...(colors as ThemeColors) },
    radius,
    density: value.density,
    backdrop: value.backdrop,
    headingFont: value.headingFont,
    shadow: value.shadow,
  };
}

/** A custom theme's name: trimmed, 1–40 characters. */
export function cleanThemeName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.length >= 1 && trimmed.length <= CUSTOM_THEME_NAME_MAX ? trimmed : null;
}

/** The built-in theme a custom one is painted on (its `data-theme`): the stylesheet's dark or light set. */
export function baseTheme(base: ThemeBase): ThemeKey {
  return base === "light" ? "light" : "gradus";
}

// --- derived palette ----------------------------------------------------------

/** Text must reach WCAG AA for normal text; accents and states AA for large text and UI parts. */
export const TEXT_MIN = 4.5;
export const ACCENT_MIN = 3;

/**
 * Every colour token of the design system for these choices. Lines, hover
 * surfaces and the softer text colours are mixed from the chosen ones; the
 * softer text is pulled back to AA if mixing took it below.
 */
export function derivePalette(tokens: CustomThemeTokens): Palette & { "on-violet": string } {
  const { canvas, surface, ink, accent, accent2 } = tokens.colors;
  const base = BUILTIN_PALETTES[baseTheme(tokens.base)];
  const dark = tokens.base === "dark";
  const soft = withContrast(mix(ink, surface, 0.28), surface, TEXT_MIN) ?? ink;
  const muted = withContrast(mix(ink, surface, 0.45), surface, TEXT_MIN) ?? soft;
  return {
    canvas,
    "canvas-deep": dark ? mix(canvas, "#000000", 0.3) : mix(canvas, ink, 0.05),
    surface,
    "surface-hover": mix(surface, ink, dark ? 0.05 : 0.04),
    grid: mix(canvas, ink, dark ? 0.06 : 0.07),
    line: mix(surface, ink, dark ? 0.16 : 0.14),
    "line-strong": mix(surface, ink, dark ? 0.26 : 0.24),
    violet: accent,
    teal: accent2,
    gold: base.gold,
    green: tokens.colors.success ?? base.green,
    orange: tokens.colors.warning ?? base.orange,
    pink: tokens.colors.danger ?? base.pink,
    ink,
    "ink-soft": soft,
    "ink-muted": muted,
    "on-violet": readableOn(accent),
  };
}

/** What a custom theme puts on the element that carries it (<html>, a preview, a miniature). */
export type AppearanceView = {
  theme: ThemeKey;
  /** CSS custom properties, only for a custom theme. */
  style: Record<string, string>;
  /** `data-*` attributes, only for a custom theme. */
  attrs: Record<string, string>;
};

/** A built-in theme: the stylesheet does everything. */
export function builtinView(theme: ThemeKey): AppearanceView {
  return { theme, style: {}, attrs: {} };
}

/** The CSS variables and attributes of a custom theme. */
export function customView(tokens: CustomThemeTokens): AppearanceView {
  const palette = derivePalette(tokens);
  const style: Record<string, string> = {};
  for (const [token, value] of Object.entries(palette)) style[`--color-${token}`] = value;
  style["--primary-foreground"] = palette["on-violet"];
  style["--sidebar-primary-foreground"] = palette["on-violet"];
  style["--radius-card"] = `${tokens.radius}px`;
  style["--radius"] = `${Math.round(tokens.radius * 0.75 * 100) / 100}px`;
  const attrs: Record<string, string> = {
    "data-custom-theme": "",
    "data-backdrop": tokens.backdrop,
    "data-shadow": tokens.shadow,
  };
  if (tokens.density !== "comfortable") attrs["data-density"] = tokens.density;
  if (tokens.headingFont !== "inter") attrs["data-heading-font"] = tokens.headingFont;
  return { theme: baseTheme(tokens.base), style, attrs };
}

/** Every attribute a view may set, so switching away from a custom theme removes them all. */
export const VIEW_ATTRIBUTES = [
  "data-custom-theme",
  "data-backdrop",
  "data-shadow",
  "data-density",
  "data-heading-font",
] as const;

// --- contrast -----------------------------------------------------------------

export type ContrastIssue = {
  /** The foreground colour to change. */
  color: ThemeColorKey;
  against: "canvas" | "surface";
  ratio: number;
  min: number;
};

const CHECKS: Array<{ color: ThemeColorKey; against: "canvas" | "surface"; min: number }> = [
  { color: "ink", against: "canvas", min: TEXT_MIN },
  { color: "ink", against: "surface", min: TEXT_MIN },
  { color: "accent", against: "surface", min: ACCENT_MIN },
  { color: "accent2", against: "surface", min: ACCENT_MIN },
  { color: "success", against: "surface", min: ACCENT_MIN },
  { color: "warning", against: "surface", min: ACCENT_MIN },
  { color: "danger", against: "surface", min: ACCENT_MIN },
];

/** The pairs below their WCAG AA minimum, text first. A status colour counts only when chosen. */
export function contrastIssues(tokens: CustomThemeTokens): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const check of CHECKS) {
    const color = tokens.colors[check.color];
    if (!color) continue;
    const ratio = contrastRatio(color, tokens.colors[check.against]);
    if (ratio < check.min) issues.push({ ...check, ratio });
  }
  return issues;
}

/**
 * Whether a theme may be saved: its text reads (AA) on the background and
 * on cards. The database refuses the same (`public.custom_theme_readable`).
 */
export function isReadable(tokens: CustomThemeTokens): boolean {
  return contrastIssues(tokens).length === 0;
}

/**
 * One click repair: the foreground's lightness moves away from its
 * background until it reaches the minimum (with a little margin). When the
 * background is so mid-grey that no foreground can, the background moves.
 */
export function fixContrast(tokens: CustomThemeTokens, issue: ContrastIssue): CustomThemeTokens {
  const background = tokens.colors[issue.against];
  const color = tokens.colors[issue.color];
  if (!color) return tokens;
  // Text has to read on both the background and the cards.
  const backgrounds = issue.color === "ink" ? [tokens.colors.canvas, tokens.colors.surface] : [background];
  let next: string | null = color;
  for (const bg of backgrounds) next = next ? withContrast(next, bg, issue.min + 0.05) : null;
  if (next && backgrounds.every((bg) => contrastRatio(next as string, bg) >= issue.min)) {
    return { ...tokens, colors: { ...tokens.colors, [issue.color]: next } };
  }
  const moved = withContrast(background, color, issue.min + 0.05) ?? background;
  return { ...tokens, colors: { ...tokens.colors, [issue.against]: moved } };
}

/** Repairs every issue, text first (a background moved for the text can create a new accent issue). */
export function fixAllContrast(tokens: CustomThemeTokens): CustomThemeTokens {
  let current = tokens;
  for (let round = 0; round < 8; round += 1) {
    const [issue] = contrastIssues(current);
    if (!issue) return current;
    current = fixContrast(current, issue);
  }
  return current;
}

// --- starting points ----------------------------------------------------------

/** A built-in theme as editable choices ("start from Forest"). */
export function tokensFromBuiltin(theme: ThemeKey): CustomThemeTokens {
  const palette = BUILTIN_PALETTES[theme];
  return {
    v: 1,
    base: theme === "light" ? "light" : "dark",
    colors: {
      canvas: palette.canvas,
      surface: palette.surface,
      ink: palette.ink,
      accent: palette.violet,
      accent2: palette.teal,
    },
    radius: DEFAULT_RADIUS,
    density: "comfortable",
    backdrop: "glow",
    headingFont: "inter",
    shadow: "normal",
  };
}

/**
 * A whole palette from one colour: the colour is the main accent (pulled to
 * the contrast it needs), the second accent is its hue turned by 150°, and
 * the background and cards are deep (dark) or pale (light) tints of its hue.
 */
export function generateFromColor(input: string, base: ThemeBase): CustomThemeTokens {
  const seed = normalizeHex(input) ?? BUILTIN_PALETTES.gradus.violet;
  const { h, c } = toOklch(seed);
  const tint = Math.min(c, 0.12);
  const dark = base === "dark";
  const canvas = dark
    ? fromOklch({ l: 0.15, c: tint * 0.35, h })
    : fromOklch({ l: 0.975, c: tint * 0.08, h });
  const surface = dark
    ? fromOklch({ l: 0.21, c: tint * 0.45, h })
    : "#ffffff";
  const ink = dark ? "#ffffff" : fromOklch({ l: 0.22, c: tint * 0.25, h });
  const accent = withContrast(seed, surface, ACCENT_MIN + 0.2) ?? seed;
  const second = fromOklch({ l: dark ? 0.82 : 0.55, c: Math.max(0.1, Math.min(c, 0.16)), h: (h + 150) % 360 });
  const accent2 = withContrast(second, surface, ACCENT_MIN + 0.2) ?? second;
  return {
    v: 1,
    base,
    colors: { canvas, surface, ink, accent, accent2 },
    radius: DEFAULT_RADIUS,
    density: "comfortable",
    backdrop: "glow",
    headingFont: "inter",
    shadow: "normal",
  };
}


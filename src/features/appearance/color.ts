/**
 * Colour arithmetic for custom themes (30.6): hex parsing, WCAG contrast
 * and OKLCH for lightness changes and hue turns. Pure, no DOM. A colour is
 * always a lowercase `#rrggbb`; anything else is refused by `parseHex`.
 */

export type Rgb = { r: number; g: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const HEX = /^#([0-9a-f]{6})$/;

/** `#RRGGBB` or `#rrggbb` (also without #, also the 3-digit form) as lowercase `#rrggbb`, else null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.replace(/./g, (c) => c + c)}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function parseHex(hex: string): Rgb | null {
  const match = HEX.exec(hex);
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG 2 relative luminance, 0 (black) … 1 (white). Same formula as `public.hex_luminance`. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/** WCAG 2 contrast ratio, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- OKLab / OKLCH (Björn Ottosson) -------------------------------------------

function rgbToOklab({ r, g, b }: Rgb): { L: number; a: number; b: number } {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Linear sRGB of an OKLab colour; may be outside 0…1 (out of gamut). */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function toOklch(hex: string): Oklch {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const { L, a, b } = rgbToOklab(rgb);
  const c = Math.sqrt(a * a + b * b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** The nearest sRGB colour: the chroma shrinks until it fits (hue and lightness stay). */
export function fromOklch({ l, c, h }: Oklch): string {
  const L = Math.min(1, Math.max(0, l));
  const rad = (h * Math.PI) / 180;
  let chroma = Math.max(0, c);
  for (let i = 0; i < 24; i += 1) {
    const [r, g, b] = oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
    const inGamut = [r, g, b].every((v) => v >= -0.0005 && v <= 1.0005);
    if (inGamut || chroma < 0.0005) {
      return toHex({ r: fromLinear(clamp01(r)), g: fromLinear(clamp01(g)), b: fromLinear(clamp01(b)) });
    }
    chroma *= 0.88;
  }
  const [r, g, b] = oklabToLinear(L, 0, 0);
  return toHex({ r: fromLinear(clamp01(r)), g: fromLinear(clamp01(g)), b: fromLinear(clamp01(b)) });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** `a` moved towards `b` by `t` (0 = a, 1 = b), in OKLab so the steps look even. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbToOklab(parseHex(a) ?? { r: 0, g: 0, b: 0 });
  const y = rgbToOklab(parseHex(b) ?? { r: 0, g: 0, b: 0 });
  const k = clamp01(t);
  const [r, g, bl] = oklabToLinear(
    x.L + (y.L - x.L) * k,
    x.a + (y.a - x.a) * k,
    x.b + (y.b - x.b) * k,
  );
  return toHex({ r: fromLinear(clamp01(r)), g: fromLinear(clamp01(g)), b: fromLinear(clamp01(bl)) });
}

/**
 * The colour with the same hue and chroma whose lightness is moved, step by
 * step, away from `background` until the contrast reaches `min`. Returns null
 * when even black or white would not reach it.
 */
export function withContrast(color: string, background: string, min: number): string | null {
  if (contrastRatio(color, background) >= min) return color;
  const start = toOklch(color);
  const lighter = relativeLuminance(background) < 0.18;
  // Try the natural direction first (lighter on dark backgrounds), then the other one.
  for (const up of lighter ? [true, false] : [false, true]) {
    for (let step = 1; step <= 100; step += 1) {
      const l = up ? start.l + (1 - start.l) * (step / 100) : start.l * (1 - step / 100);
      const next = fromOklch({ ...start, l });
      if (contrastRatio(next, background) >= min) return next;
    }
  }
  return null;
}

/** Black or white text, whichever reads better on `background`. */
export function readableOn(background: string, light = "#ffffff", dark = "#0b0f1a"): string {
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

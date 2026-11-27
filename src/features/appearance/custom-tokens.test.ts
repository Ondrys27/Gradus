import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/lib/themes";
import { BUILTIN_PALETTES, PALETTE_TOKENS } from "./builtin-palettes";
import { contrastRatio, isHex, mix, normalizeHex, relativeLuminance } from "./color";
import {
  cleanThemeName,
  contrastIssues,
  customView,
  derivePalette,
  fixAllContrast,
  fixContrast,
  generateFromColor,
  isReadable,
  parseCustomThemeTokens,
  tokensFromBuiltin,
  type CustomThemeTokens,
} from "./custom-tokens";
import { formatShareCode, parseShareCode, shareLink } from "./share";
import { gateReason, isTyping, transitionDecision, witnessed, type GateState } from "./transition-gate";

const base: CustomThemeTokens = tokensFromBuiltin("gradus");

describe("colour arithmetic", () => {
  it("normalises hex", () => {
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("fff")).toBe("#ffffff");
    expect(normalizeHex(" #12345 ")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(isHex("#abcdef")).toBe(true);
    expect(isHex("#ABCDEF")).toBe(false);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The WCAG example: #777 on white is just below 4.5.
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("mixes in OKLab between the two", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    const middle = relativeLuminance(mix("#000000", "#ffffff", 0.5));
    expect(middle).toBeGreaterThan(0.1);
    expect(middle).toBeLessThan(0.3);
  });
});

describe("the built-in palettes match globals.css", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  it.each(THEMES)("%s", (theme) => {
    const block = new RegExp(`\\[data-theme="${theme}"\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    for (const token of PALETTE_TOKENS) {
      const value = new RegExp(`--color-${token}: (#[0-9a-f]{6});`).exec(block)?.[1];
      expect(value, `${theme} ${token}`).toBe(BUILTIN_PALETTES[theme][token]);
    }
    expect(block).toMatch(/--color-on-violet: #ffffff;/);
  });
});

describe("parseCustomThemeTokens (= valid_custom_theme_tokens)", () => {
  it("takes the stored shape", () => {
    expect(parseCustomThemeTokens(base)).toEqual(base);
    const withStates = { ...base, colors: { ...base.colors, success: "#22aa66" } };
    expect(parseCustomThemeTokens(withStates)?.colors.success).toBe("#22aa66");
  });

  it("refuses anything that could become CSS", () => {
    const bad = (patch: Record<string, unknown>) => parseCustomThemeTokens({ ...base, ...patch });
    expect(bad({ colors: { ...base.colors, canvas: "red" } })).toBeNull();
    expect(bad({ colors: { ...base.colors, canvas: "#FFFFFF" } })).toBeNull();
    expect(bad({ colors: { ...base.colors, canvas: "#fff; background: url(x)" } })).toBeNull();
    expect(bad({ colors: { ...base.colors, extra: "#ffffff" } })).toBeNull();
    const withoutInk: Record<string, string> = { ...base.colors };
    delete withoutInk.ink;
    expect(bad({ colors: withoutInk })).toBeNull();
    expect(bad({ radius: 25 })).toBeNull();
    expect(bad({ radius: 3.5 })).toBeNull();
    expect(bad({ density: "huge" })).toBeNull();
    expect(bad({ backdrop: "image" })).toBeNull();
    expect(bad({ headingFont: "Comic Sans" })).toBeNull();
    expect(bad({ shadow: "max" })).toBeNull();
    expect(bad({ css: "body{}" })).toBeNull();
    expect(bad({ v: 2 })).toBeNull();
    expect(parseCustomThemeTokens(null)).toBeNull();
    expect(parseCustomThemeTokens([])).toBeNull();
  });

  it("cleans the name", () => {
    expect(cleanThemeName("  Moje   ráno ")).toBe("Moje ráno");
    expect(cleanThemeName("   ")).toBeNull();
    expect(cleanThemeName("x".repeat(41))).toBeNull();
  });
});

describe("derived tokens", () => {
  it("every built-in theme as a starting point is readable", () => {
    for (const theme of THEMES) expect(isReadable(tokensFromBuiltin(theme)), theme).toBe(true);
  });

  it("softer text stays AA on cards", () => {
    const palette = derivePalette(base);
    expect(contrastRatio(palette["ink-soft"], palette.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette["ink-muted"], palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("text on the accent is black or white, whichever reads", () => {
    expect(derivePalette({ ...base, colors: { ...base.colors, accent: "#ffe066" } })["on-violet"]).toBe("#0b0f1a");
    expect(derivePalette({ ...base, colors: { ...base.colors, accent: "#3b1fa8" } })["on-violet"]).toBe("#ffffff");
  });

  it("the view sets variables and attributes only from the lists", () => {
    const view = customView({ ...base, density: "compact", headingFont: "fraunces", radius: 8 });
    expect(view.theme).toBe("gradus");
    expect(view.style["--color-canvas"]).toBe(base.colors.canvas);
    expect(view.style["--radius-card"]).toBe("8px");
    expect(view.style["--radius"]).toBe("6px");
    expect(view.attrs).toEqual({
      "data-custom-theme": "",
      "data-backdrop": "glow",
      "data-shadow": "normal",
      "data-density": "compact",
      "data-heading-font": "fraunces",
    });
    expect(Object.values(view.style).every((value) => /^(#[0-9a-f]{6}|[0-9.]+px)$/.test(value))).toBe(true);
    expect(customView({ ...base, base: "light" }).theme).toBe("light");
  });
});

describe("contrast check and repair", () => {
  it("flags unreadable text and weak accents", () => {
    const grey = { ...base, colors: { ...base.colors, ink: "#20263f" } };
    const issues = contrastIssues(grey);
    expect(issues.map((issue) => `${issue.color}/${issue.against}`)).toEqual(["ink/canvas", "ink/surface"]);
    expect(isReadable(grey)).toBe(false);
    const faint = { ...base, colors: { ...base.colors, accent: "#1a1f44" } };
    expect(contrastIssues(faint)[0]).toMatchObject({ color: "accent", against: "surface", min: 3 });
  });

  it("fixes one issue with one click", () => {
    const grey = { ...base, colors: { ...base.colors, ink: "#20263f" } };
    const fixed = fixContrast(grey, contrastIssues(grey)[0]);
    expect(contrastRatio(fixed.colors.ink, fixed.colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.colors.ink, fixed.colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("a mid-grey background that no text can beat moves itself", () => {
    const mid = { ...base, colors: { ...base.colors, canvas: "#767676", surface: "#767676", ink: "#7a7a7a" } };
    expect(isReadable(fixAllContrast(mid))).toBe(true);
  });

  it("a status colour counts only when chosen", () => {
    expect(contrastIssues(base)).toEqual([]);
    const weak = { ...base, colors: { ...base.colors, danger: "#2a1020" } };
    expect(contrastIssues(weak).map((issue) => issue.color)).toEqual(["danger"]);
  });
});

describe("one colour to a whole theme", () => {
  it.each([
    ["#7c5cff", "dark"],
    ["#ff8a3d", "dark"],
    ["#ffe066", "dark"],
    ["#14532d", "dark"],
    ["#7c5cff", "light"],
    ["#ffe066", "light"],
    ["#0ea5e9", "light"],
    ["#000000", "dark"],
    ["#ffffff", "light"],
  ] as const)("%s on %s is valid and readable", (seed, mode) => {
    const theme = generateFromColor(seed, mode);
    expect(parseCustomThemeTokens(theme)).toEqual(theme);
    expect(contrastIssues(theme)).toEqual([]);
    if (mode === "dark") expect(relativeLuminance(theme.colors.canvas)).toBeLessThan(0.05);
    else expect(relativeLuminance(theme.colors.canvas)).toBeGreaterThan(0.8);
  });
});

describe("share codes", () => {
  it("reads a code or a link", () => {
    expect(parseShareCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(parseShareCode("https://gradus.cz/app/nastaveni/vzhled?vzhled=ABCDEFGHJK")).toBe("ABCDEFGHJK");
    expect(parseShareCode("ABCDEFGHJ0")).toBeNull();
    expect(parseShareCode("short")).toBeNull();
    expect(shareLink("https://gradus.cz/", "ABCDEFGHJK")).toBe("https://gradus.cz/app/nastaveni/vzhled?vzhled=ABCDEFGHJK");
    expect(formatShareCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
});

describe("when the transition plays", () => {
  const calm: GateState = {
    focusInField: false,
    lastKeyAt: null,
    dialogOpen: false,
    timerRunning: false,
    tutorial: false,
    liveNoteTyping: false,
    showcase: false,
    hidden: false,
  };
  const due = 1_000_000;

  it("plays when nothing is in the way", () => {
    expect(transitionDecision(due, due + 100, calm)).toBe("play");
  });

  it("waits while typing: focus in a field and a key within 5 seconds", () => {
    const typing = { ...calm, focusInField: true, lastKeyAt: due };
    expect(isTyping(typing, due + 4_999)).toBe(true);
    expect(transitionDecision(due, due + 1_000, typing)).toBe("wait");
    expect(transitionDecision(due, due + 5_000, typing)).toBe("play");
    // A key long ago, or focus elsewhere, is not typing.
    expect(isTyping({ ...typing, focusInField: false }, due + 10)).toBe(false);
  });

  it.each([
    ["dialogOpen", "dialog"],
    ["timerRunning", "timer"],
    ["tutorial", "tutorial"],
    ["liveNoteTyping", "liveNote"],
    ["showcase", "showcase"],
    ["hidden", "hidden"],
  ] as const)("waits for %s", (key, reason) => {
    const state = { ...calm, [key]: true };
    expect(gateReason(state, due)).toBe(reason);
    expect(transitionDecision(due, due + 60_000, state)).toBe("wait");
  });

  it("after 5 minutes of waiting changes the theme quietly", () => {
    const state = { ...calm, dialogOpen: true };
    expect(transitionDecision(due, due + 5 * 60_000 - 1, state)).toBe("wait");
    expect(transitionDecision(due, due + 5 * 60_000, state)).toBe("silent");
    expect(transitionDecision(due, due + 5 * 60_000, calm)).toBe("silent");
  });

  it("only for a boundary the user saw happen", () => {
    expect(witnessed(due, due - 30_000, due + 50)).toBe(true);
    // the app was just opened
    expect(witnessed(due, null, due + 50)).toBe(false);
    // the laptop slept through it
    expect(witnessed(due, due - 3 * 3_600_000, due + 3_600_000)).toBe(false);
    // not yet
    expect(witnessed(due, due - 30_000, due - 10)).toBe(false);
  });
});

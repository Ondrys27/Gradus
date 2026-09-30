/**
 * Keeps the stacking order in one place (the `z-*` layer utilities in
 * globals.css). A select or menu that opens under a dialog or the onboarding
 * takeover looks like it "does not open", so every floating positioner must use
 * the popover layer and no surface may pick a raw high z-index of its own.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file),
  text: readFileSync(file, "utf8"),
}));

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

describe("stacking layers", () => {
  it("every floating positioner sits on the popover layer", () => {
    const wrong = files.flatMap(({ rel, text }) =>
      [...text.matchAll(/<[A-Za-z]+\.Positioner\b[^>]*>/g)]
        .filter((match) => !/\bz-popover\b/.test(match[0]))
        .map((match) => `${rel}:${lineOf(text, match.index)}`),
    );
    expect(wrong).toEqual([]);
  });

  it("no component uses a raw z-index at or above the navigation layer", () => {
    const raw = files.flatMap(({ rel, text }) =>
      [...text.matchAll(/(?<![\w-])z-(?:\[(?:[4-9]\d|\d{3,})\]|[4-9]\d|\d{3,})(?![\w-])/g)].map(
        (match) => `${rel}:${lineOf(text, match.index)} ${match[0]}`,
      ),
    );
    expect(raw).toEqual([]);
  });
});

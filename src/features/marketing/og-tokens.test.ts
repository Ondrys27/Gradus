import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OG_TOKEN_SOURCES, OG_TOKENS } from "./og-tokens";

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
const gradus = css.slice(
  css.indexOf('[data-theme="gradus"]'),
  css.indexOf("}", css.indexOf('[data-theme="gradus"]')),
);

describe("Open Graph colours", () => {
  it.each(Object.entries(OG_TOKEN_SOURCES))(
    "%s equals %s of the default theme",
    (key, variable) => {
      const match = gradus.match(new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`));
      expect(match?.[1]?.toLowerCase()).toBe(OG_TOKENS[key as keyof typeof OG_TOKENS]);
    },
  );
});

// @vitest-environment node
//
// Step 28.9: every model call of the app is one of Grady's jobs and goes
// through the guard (budget, the job's model, ai_usage). Scans the source:
// only server/model.ts (streamModel), the tools loop and the batches talk to
// the API, only model.ts makes the SDK client, and every job a call names is
// in the catalog. MCP never calls a model.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_MODELS } from "./model-settings";
import { GRADY_FEATURES } from "./models";

const SRC = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const sources = files(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: readFileSync(file, "utf8"),
}));

describe("every model call goes through the guard", () => {
  it("talks to the API only in streamModel, the tools loop and the batches", () => {
    const callers = sources
      .filter(({ text }) => /\.messages\.(stream|create)\(|\)\.batches\b|\.messages\.batches\b|\.countTokens\(/.test(text))
      .map(({ file }) => file)
      .sort();
    expect(callers).toEqual([
      "features/grady/server/batch.ts",
      "features/grady/server/model.ts",
      "features/grady/server/tools/loop.ts",
    ]);
  });

  it("makes the SDK client only in createAnthropic", () => {
    const makers = sources
      .filter(({ text }) => /new Anthropic\(/.test(text))
      .map(({ file }) => file);
    expect(makers).toEqual(["features/grady/server/model.ts"]);
    const valueImports = sources
      .filter(({ text }) => /^import (?!type )[^\n]*from "@anthropic-ai\/sdk"/m.test(text))
      .map(({ file }) => file);
    expect(valueImports).toEqual(["features/grady/server/model.ts"]);
  });

  it("names a job of the catalog in every call, and the catalog covers every job", () => {
    const named = new Set<string>();
    for (const { text } of sources.filter(({ file }) => file.includes("grady") || file.includes("api/"))) {
      for (const match of text.matchAll(/\bfeature: "([a-z_]+)"/g)) named.add(match[1]);
    }
    for (const feature of named) expect(GRADY_FEATURES).toContain(feature);
    for (const feature of GRADY_FEATURES) expect(FEATURE_MODELS[feature]).toBeDefined();
  });

  it("never calls a model from the MCP server", () => {
    for (const { file, text } of sources.filter(({ file }) => /mcp/.test(file))) {
      expect(text, file).not.toMatch(/createAnthropic|streamModel|streamWithTools/);
    }
  });
});

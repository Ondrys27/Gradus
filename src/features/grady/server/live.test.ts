// @vitest-environment node
//
// Grady against the real API: one short call per model through the same
// streamModel the route uses, so a wrong model id or a parameter the model
// refuses shows up here. Costs a few cents, so it runs only on request:
//   GRADY_LIVE=1 bun --env-file=.env.local run test src/features/grady/server/live.test.ts
// (ANTHROPIC_API_KEY comes from .env.local).
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { GradyFeature } from "../models";

vi.mock("server-only", () => ({}));

const { streamModel } = await import("./model");
const { GRADY_MODELS, costUsd } = await import("../models");

const live = process.env.GRADY_LIVE === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!live)("Grady against the real API", () => {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

  const cases: [GradyFeature, string][] = [
    ["classify", GRADY_MODELS.haiku],
    ["chat", GRADY_MODELS.sonnet],
    ["analysis", GRADY_MODELS.opus],
  ];

  it.each(cases)(
    "%s answers on %s and is priced",
    async (feature, model) => {
      const log = vi.fn().mockResolvedValue(undefined);
      const result = await streamModel({
        client: { messages: anthropic.messages },
        userId: null,
        feature,
        context: "",
        messages: [
          { role: "user", content: "This is a connection test. Reply with one short sentence." },
        ],
        log,
      });
      expect(log.mock.calls[0]?.[0]?.error, String(log.mock.calls[0]?.[0]?.error)).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.model).toBe(model);
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(costUsd(result.model, result.tokens)).toBeGreaterThan(0);
    },
    120_000,
  );
});

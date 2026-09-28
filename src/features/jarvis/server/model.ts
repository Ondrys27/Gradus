import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  EMPTY_USAGE,
  JARVIS_MODELS,
  maxTokensFor,
  modelFor,
  type JarvisFeature,
  type JarvisModel,
  type TokenUsage,
} from "../models";
import { JARVIS_PERSONA } from "../prompt";
import type { ChatErrorCode } from "../protocol";
import type { AiUsageEntry } from "./usage";

/**
 * The only place that talks to Anthropic. It is called from /api/jarvis and
 * nowhere else; the key never leaves the server.
 */
export function createAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 1 });
}

export type ModelClient = Pick<Anthropic, "messages">;

export type ModelCall = {
  client: ModelClient;
  feature: JarvisFeature;
  /**
   * The fixed part of the system prompt, cached. Jarvis's persona by default;
   * routine jobs (classification, the opportunity watch) pass their own short one.
   */
  instructions?: string;
  /** Per-call context placed after the cached instructions. */
  context: string;
  messages: Anthropic.MessageParam[];
  onText?: (text: string) => void;
  /** Writes the ai_usage row; called exactly once, right when the call ends. */
  log: (entry: Omit<AiUsageEntry, "userId" | "conversationId">) => Promise<void>;
};

export type ModelResult =
  | { ok: true; model: JarvisModel; text: string; tokens: TokenUsage }
  | { ok: false; model: JarvisModel; code: ChatErrorCode; text: string; tokens: TokenUsage };

/**
 * Streams one answer. The persona is the cached prefix; the context follows
 * it uncached because it changes with the user's data. Tokens are read from
 * the stream events, so a call that fails midway is still counted.
 */
export async function streamModel(call: ModelCall): Promise<ModelResult> {
  const model = modelFor(call.feature);
  const tokens: TokenUsage = { ...EMPTY_USAGE };
  const started = Date.now();
  let text = "";

  const params: Anthropic.MessageStreamParams = {
    model,
    max_tokens: maxTokensFor(call.feature),
    system: [
      {
        type: "text",
        text: call.instructions ?? JARVIS_PERSONA,
        cache_control: { type: "ephemeral" },
      },
      ...(call.context ? [{ type: "text" as const, text: call.context }] : []),
    ],
    messages: call.messages,
    // Haiku takes no effort setting; conversation stays quick on the others.
    ...(model === JARVIS_MODELS.haiku
      ? {}
      : { output_config: { effort: call.feature === "analysis" ? "high" : "low" } }),
  };

  try {
    const stream = call.client.messages.stream(params);
    let stopReason: string | null = null;
    for await (const event of stream) {
      switch (event.type) {
        case "message_start": {
          const usage = event.message.usage;
          tokens.inputTokens = usage.input_tokens;
          tokens.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
          tokens.cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
          tokens.outputTokens = usage.output_tokens;
          break;
        }
        case "message_delta":
          tokens.outputTokens = event.usage.output_tokens;
          stopReason = event.delta.stop_reason;
          break;
        case "content_block_delta":
          if (event.delta.type === "text_delta") {
            text += event.delta.text;
            call.onText?.(event.delta.text);
          }
          break;
      }
    }

    if (!text.trim()) {
      const error = `empty answer (stop_reason: ${stopReason ?? "none"})`;
      await call.log({
        feature: call.feature,
        model,
        tokens,
        durationMs: Date.now() - started,
        error,
      });
      return { ok: false, model, code: "unavailable", text, tokens };
    }
    await call.log({ feature: call.feature, model, tokens, durationMs: Date.now() - started });
    return { ok: true, model, text, tokens };
  } catch (error) {
    await call.log({
      feature: call.feature,
      model,
      tokens,
      durationMs: Date.now() - started,
      error: describeError(error),
    });
    return { ok: false, model, code: errorCode(error), text, tokens };
  }
}

/** What the panel says; the details stay in ai_usage.error. */
export function errorCode(error: unknown): ChatErrorCode {
  if (error instanceof Anthropic.RateLimitError) return "busy";
  if (error instanceof Anthropic.AuthenticationError) return "notConfigured";
  if (error instanceof Anthropic.PermissionDeniedError) return "notConfigured";
  if (error instanceof Anthropic.APIError && error.type === "overloaded_error") return "busy";
  // Missing credits, bad requests, outages and lost connections all read the same to the user.
  return "unavailable";
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `${error.status ?? "no status"} ${error.type ?? ""} ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

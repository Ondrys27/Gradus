import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
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
import { createBudgetGuard, type BudgetGuard } from "./budget";
import type { AiUsageEntry } from "./usage";

/**
 * The SDK's messages and the monthly budget that guards them. Every client
 * made by createAnthropic carries the guard; test doubles may leave it out.
 */
export type ModelClient = Pick<Anthropic, "messages"> & { budget?: BudgetGuard };
export type JarvisClient = ModelClient & { budget: BudgetGuard };

/**
 * The only place that talks to Anthropic. It is called from /api/jarvis and
 * nowhere else; the key never leaves the server. The admin client reads the
 * month's spend (all accounts) and records the owner's budget e-mails.
 */
export function createAnthropic(admin: SupabaseClient<Database>): JarvisClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey, maxRetries: 1 });
  return { messages: anthropic.messages, budget: createBudgetGuard(admin) };
}

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

  if (call.client.budget && !(await call.client.budget.allows(call.feature))) {
    return { ok: false, model, code: "paused", text, tokens };
  }

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
    // Routine Haiku work answers without thinking first, as it did before
    // thinking came to Haiku; conversation stays quick on the others.
    ...(model === JARVIS_MODELS.haiku
      ? { thinking: { type: "disabled" }, output_config: { effort: "low" } }
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
      console.error(`jarvis ${call.feature} on ${model} failed: ${error}`);
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
    const reason = describeError(error);
    // Without this the reason was only in ai_usage and the server log stayed silent.
    console.error(`jarvis ${call.feature} on ${model} failed: ${reason}`);
    await call.log({
      feature: call.feature,
      model,
      tokens,
      durationMs: Date.now() - started,
      error: reason,
    });
    const credit = creditErrorCode(error);
    if (credit) await call.client.budget?.creditsExhausted(call.feature, credit);
    return { ok: false, model, code: errorCode(error), text, tokens };
  }
}

/**
 * Spend caps reported with a machine-readable code in error.details: the
 * usage tier's monthly cap is a 429 rate_limit_error carrying this code.
 */
const SPEND_LIMIT_CODES = new Set(["enforced_spend_limit_reached"]);

function detailsCode(error: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = error.error as { error?: { details?: { error_code?: unknown } } } | undefined;
  const code = body?.error?.details?.error_code;
  return typeof code === "string" ? code : null;
}

/**
 * The API refused because the organization has no credit left or reached its
 * spend limit. Read from the SDK's error type, status and error code, never
 * from the message text: billing_error (402) or a spend-limit code. Returns
 * the code for analytics, null for every other failure.
 */
export function creditErrorCode(error: unknown): string | null {
  if (!(error instanceof Anthropic.APIError)) return null;
  if (error.type === "billing_error" || error.status === 402) return "billing_error";
  const code = detailsCode(error);
  return code && SPEND_LIMIT_CODES.has(code) ? code : null;
}

/** What the panel says; the details stay in ai_usage.error and the server log. */
export function errorCode(error: unknown): ChatErrorCode {
  if (creditErrorCode(error)) return "paused";
  if (error instanceof Anthropic.RateLimitError) return "busy";
  if (error instanceof Anthropic.AuthenticationError) return "notConfigured";
  if (error instanceof Anthropic.PermissionDeniedError) return "notConfigured";
  if (error instanceof Anthropic.APIError && error.type === "overloaded_error") return "busy";
  // Bad requests, outages and lost connections all read the same to the user.
  return "unavailable";
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `${error.status ?? "no status"} ${error.type ?? ""} ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

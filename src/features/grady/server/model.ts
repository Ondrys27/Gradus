import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AiModelKey } from "@/config/costs";
import {
  chooseModel,
  economyFor,
  needsAutoPick,
  DEFAULT_GRADY_MODELS,
  type AutoPick,
  type GradyModelSettings,
  type ModelChoice,
} from "../model-settings";
import {
  EMPTY_USAGE,
  maxTokensFor,
  type GradyFeature,
  type GradyModel,
  type TokenUsage,
} from "../models";
import { GRADY_PERSONA } from "../prompt";
import type { ChatErrorCode } from "../protocol";
import { createBudgetGuard, type BudgetGuard, type BudgetVerdict } from "./budget";
import { loadGradyModels } from "./model-settings";
import type { AiUsageEntry } from "./usage";

/**
 * The SDK's messages, the monthly budget that guards them and the model
 * settings of the administration (cached 30 s). Every client made by
 * createAnthropic carries both; test doubles may leave them out (then the
 * budget lets everything through and the defaults choose the model).
 */
export type ModelClient = Pick<Anthropic, "messages"> & {
  budget?: BudgetGuard;
  models?: () => Promise<GradyModelSettings>;
};
export type GradyClient = ModelClient & { budget: BudgetGuard };

/**
 * The only place that talks to Anthropic. It is called from /api/grady and
 * nowhere else; the key never leaves the server. The admin client reads the
 * month's spend (all accounts) and records the owner's budget e-mails.
 */
export function createAnthropic(
  admin: SupabaseClient<Database>,
  /** The space of the request: its cap covers the calls (a company's when working there). */
  options: { spaceId?: string | null } = {},
): GradyClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey, maxRetries: 1 });
  return {
    messages: anthropic.messages,
    budget: createBudgetGuard(admin, { spaceId: options.spaceId }),
    models: () => loadGradyModels(admin),
  };
}

export type ModelCall = {
  client: ModelClient;
  feature: GradyFeature;
  /**
   * Whose call it is: their own monthly cap (or block) is checked before the
   * call. Null only for calls of no single user (none today).
   */
  userId: string | null;
  /**
   * The fixed part of the system prompt, cached. Grady's persona by default;
   * routine jobs (classification, the opportunity watch) pass their own short one.
   */
  instructions?: string;
  /** Per-call context placed after the cached instructions. */
  context: string;
  messages: Anthropic.MessageParam[];
  onText?: (text: string) => void;
  /**
   * The chat's automatic choice (chat-route.ts), asked only when the chat is
   * set to auto and no economy mode applies; without it the chat runs on Sonnet.
   */
  autoPick?: () => Promise<AutoPick>;
  /**
   * The model a job that names its own runs on (the administration's model
   * comparison, feature model_compare); every other job ignores it.
   */
  explicitModel?: AiModelKey | null;
  /** Asked again after an unsure answer: the job's escalation model (model-settings.ts). */
  escalated?: boolean;
  /**
   * The job this call stands in for (the comparison runs another job's
   * prompt): its output cap and thinking apply; ai_usage keeps `feature`.
   */
  as?: GradyFeature;
  /** Writes the ai_usage row; called exactly once, right when the call ends. */
  log: (entry: Omit<AiUsageEntry, "userId" | "conversationId">) => Promise<void>;
};

export type CallPlan =
  | { ok: true; choice: ModelChoice }
  | { ok: false; code: Exclude<BudgetVerdict, "ok">; model: GradyModel };

/**
 * Before a call: the budget (pause, a cap, economy mode), then the model —
 * the job's setting, the chat's automatic choice or the job's minimum in
 * economy mode. A failed automatic choice leaves the chat on Sonnet.
 */
export async function planCall(
  call: Pick<ModelCall, "client" | "feature" | "userId" | "autoPick" | "explicitModel" | "escalated">,
): Promise<CallPlan> {
  const settings = call.client.models
    ? await call.client.models().catch((error) => {
        console.error("grady models failed", error);
        return DEFAULT_GRADY_MODELS;
      })
    : DEFAULT_GRADY_MODELS;
  const assessment = call.client.budget
    ? await call.client.budget.assess(call.feature, call.userId)
    : { verdict: "ok" as const, economy: null };
  if (assessment.verdict !== "ok") {
    return {
      ok: false,
      code: assessment.verdict,
      model: chooseModel(call.feature, settings).model.id,
    };
  }
  const economy = economyFor(settings, assessment.economy);
  let auto: AutoPick | null = null;
  if (call.autoPick && needsAutoPick(call.feature, settings, economy)) {
    auto = await call.autoPick().catch((error) => {
      console.error("grady chat route failed", error);
      return "sonnet" as const;
    });
  }
  return {
    ok: true,
    choice: chooseModel(call.feature, settings, {
      economy,
      auto,
      explicit: call.explicitModel,
      escalated: call.escalated,
    }),
  };
}

/** The thinking and effort of one call by the model it runs on. */
export function thinkingParams(
  feature: GradyFeature,
  choice: ModelChoice,
): Pick<Anthropic.MessageStreamParams, "thinking" | "output_config"> {
  // Routine Haiku work answers without thinking first, as it did before
  // thinking came to Haiku; conversation stays quick on the others.
  if (choice.model.thinkingOff) {
    return { thinking: { type: "disabled" }, output_config: { effort: "low" } };
  }
  return { output_config: { effort: feature === "analysis" ? "high" : "low" } };
}

export type ModelResult =
  | {
      ok: true;
      model: GradyModel;
      text: string;
      tokens: TokenUsage;
      /** Why the answer ended (end_turn, max_tokens…); the comparison reads it. */
      stopReason?: string | null;
    }
  | { ok: false; model: GradyModel; code: ChatErrorCode; text: string; tokens: TokenUsage };

/**
 * Streams one answer. The persona is the cached prefix; the context follows
 * it uncached because it changes with the user's data. Tokens are read from
 * the stream events, so a call that fails midway is still counted.
 */
export async function streamModel(call: ModelCall): Promise<ModelResult> {
  const tokens: TokenUsage = { ...EMPTY_USAGE };
  let text = "";

  const plan = await planCall(call);
  if (!plan.ok) return { ok: false, model: plan.model, code: plan.code, text, tokens };
  const { choice } = plan;
  const model = choice.model.id;
  const routedFrom = choice.routedFrom;
  const started = Date.now();

  const job = call.as ?? call.feature;
  const params: Anthropic.MessageStreamParams = {
    model,
    max_tokens: maxTokensFor(job, model),
    system: [
      {
        type: "text",
        text: call.instructions ?? GRADY_PERSONA,
        cache_control: { type: "ephemeral" },
      },
      ...(call.context ? [{ type: "text" as const, text: call.context }] : []),
    ],
    messages: call.messages,
    ...thinkingParams(job, choice),
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
      console.error(`grady ${call.feature} on ${model} failed: ${error}`);
      await call.log({
        feature: call.feature,
        model,
        routedFrom,
        tokens,
        durationMs: Date.now() - started,
        error,
      });
      return { ok: false, model, code: "unavailable", text, tokens };
    }
    await call.log({
      feature: call.feature,
      model,
      routedFrom,
      tokens,
      durationMs: Date.now() - started,
    });
    return { ok: true, model, text, tokens, stopReason };
  } catch (error) {
    const reason = describeError(error);
    // Without this the reason was only in ai_usage and the server log stayed silent.
    console.error(`grady ${call.feature} on ${model} failed: ${reason}`);
    await call.log({
      feature: call.feature,
      model,
      routedFrom,
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

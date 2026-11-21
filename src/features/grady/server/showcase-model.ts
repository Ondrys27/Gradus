import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Locale } from "@/i18n/locales";
import { preparedAnswer, stageData } from "@/features/tutorial/showcase/stage-data";
import type { BudgetGuard } from "./budget";
import { loadGradyModels } from "./model-settings";
import type { GradyClient } from "./model";

/**
 * Grady in the showcase (step 27.4): the stage account never reaches a
 * model. Its chat gets the prepared answer of the scenario's language
 * (stage-data.ts), streamed a few words at a time so it reads like the real
 * thing; the summary gets the prepared morning summary. No cost, the same
 * result every time. The calls still go through streamModel, so they are
 * logged (with no tokens) like any other.
 */

/** A stage account (showcase-…@gradus.local, marked by the server in app_metadata). */
export function isShowcaseStage(appMetadata: unknown): boolean {
  return (
    !!appMetadata &&
    typeof appMetadata === "object" &&
    (appMetadata as Record<string, unknown>).showcase_stage === true
  );
}

/** Never paused: a showcase must not show "Grady takes a break" because of the month's real spend. */
const OPEN_BUDGET: BudgetGuard = {
  assess: async () => ({ verdict: "ok", economy: null }),
  check: async () => "ok",
  creditsExhausted: async () => undefined,
};

const CHUNK_WORDS = 3;
const CHUNK_MS = 45;

function lastUserText(params: Pick<Anthropic.MessageStreamParams, "messages">): string {
  for (const message of [...params.messages].reverse()) {
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

export function showcaseClient(
  admin: SupabaseClient<Database>,
  locale: Locale,
  kind: "chat" | "summary",
): GradyClient {
  const stream = (params: Anthropic.MessageStreamParams) => {
    // The chat's automatic model choice asks for a word or two: answered at once.
    const routing = params.max_tokens <= 50;
    const reply = routing
      ? "haiku"
      : kind === "summary"
        ? stageData(locale).summary
        : preparedAnswer(lastUserText(params), locale);
    const words = reply.split(/(?<=\s)/);
    async function* events() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      } as unknown as Anthropic.MessageStreamEvent;
      for (let index = 0; index < words.length; index += CHUNK_WORDS) {
        if (!routing && index > 0) await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: words.slice(index, index + CHUNK_WORDS).join("") },
        } as Anthropic.MessageStreamEvent;
      }
      yield {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 },
      } as unknown as Anthropic.MessageStreamEvent;
    }
    const message = {
      id: "msg_showcase",
      type: "message",
      role: "assistant",
      model: params.model,
      content: [{ type: "text", text: reply, citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Message;
    return Object.assign(events(), { finalMessage: async () => message });
  };
  return {
    messages: { stream } as unknown as Anthropic["messages"],
    budget: OPEN_BUDGET,
    models: () => loadGradyModels(admin),
  };
}

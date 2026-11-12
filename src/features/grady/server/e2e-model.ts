import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createBudgetGuard } from "./budget";
import type { GradyClient } from "./model";

/**
 * A stand-in model for the end-to-end tests: it answers a chat message with
 * the <user_notes> block it was given, so a test can see that a note reached
 * Grady's context without paying for (or depending on) a real answer; or,
 * for the summary at the first arrival, a fixed line naming what it was
 * asked to write.
 *
 * It exists only outside production, only for the tests' own accounts
 * (e2e-…@gradus.local) and only when the request asks for it with this
 * header; every other request talks to Anthropic as always. The call still
 * goes through streamModel, so it is logged in ai_usage like any other.
 */
export const E2E_MODEL_HEADER = "x-gradus-e2e-model";
export const E2E_ECHO_NOTES = "echo-notes";
export const E2E_ECHO_SUMMARY = "echo-summary";
export type E2eModel = typeof E2E_ECHO_NOTES | typeof E2E_ECHO_SUMMARY;
export const E2E_NO_NOTES = "NO_USER_NOTES";
/** The summary stand-in's text starts with this. */
export const E2E_SUMMARY_TEXT = "E2E summary";

const E2E_EMAIL = /^e2e-[a-z0-9-]+@gradus\.local$/i;

export function wantsE2eEcho(
  headers: Pick<Headers, "get">,
  email: string | null,
  model: E2eModel = E2E_ECHO_NOTES,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (nodeEnv === "production") return false;
  if (headers.get(E2E_MODEL_HEADER) !== model) return false;
  return !!email && E2E_EMAIL.test(email);
}

/** The notes block out of the system prompt, or a marker when there is none. */
export function echoedNotes(params: Pick<Anthropic.MessageStreamParams, "system">): string {
  const system = Array.isArray(params.system)
    ? params.system.map((block) => block.text).join("\n")
    : (params.system ?? "");
  const match = /<user_notes>[\s\S]*<\/user_notes>/.exec(system);
  return match ? match[0] : E2E_NO_NOTES;
}

/** The summary stand-in: what it was asked for (the last user message), never the data. */
export function echoedAsk(params: Pick<Anthropic.MessageStreamParams, "messages">): string {
  const last = params.messages.at(-1)?.content;
  const ask = typeof last === "string" ? last : "";
  return `${E2E_SUMMARY_TEXT}: ${ask}`;
}

export function e2eEchoClient(
  admin: SupabaseClient<Database>,
  model: E2eModel = E2E_ECHO_NOTES,
): GradyClient {
  const answer = model === E2E_ECHO_SUMMARY ? echoedAsk : echoedNotes;
  const stream = (params: Anthropic.MessageStreamParams) =>
    (async function* () {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      } as unknown as Anthropic.MessageStreamEvent;
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: answer(params) },
      } as Anthropic.MessageStreamEvent;
      yield {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 },
      } as unknown as Anthropic.MessageStreamEvent;
    })();
  return {
    messages: { stream } as unknown as Anthropic["messages"],
    budget: createBudgetGuard(admin),
  };
}

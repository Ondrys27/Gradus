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
/**
 * The tools stand-in (26.2): the first call answers with the tool calls
 * listed in E2E_TOOLS_HEADER (base64 JSON `[{ name, input }]`), only those
 * the account was offered; the next call (with their results) answers with
 * a line naming what came back. A listed tool that was not offered is named
 * in the answer instead ("not offered: …"), so a test sees the rights.
 */
export const E2E_TOOL_SCRIPT = "tool-script";
export const E2E_TOOLS_HEADER = "x-gradus-e2e-tools";
export const E2E_TOOLS_TEXT = "E2E tools";
export type E2eModel = typeof E2E_ECHO_NOTES | typeof E2E_ECHO_SUMMARY | typeof E2E_TOOL_SCRIPT;
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

export type E2eToolCall = { name: string; input: Record<string, unknown> };

/** The scripted calls of the header; anything unreadable is no script. */
export function e2eToolScript(headers: Pick<Headers, "get">): E2eToolCall[] {
  const raw = headers.get(E2E_TOOLS_HEADER);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is E2eToolCall =>
          !!item && typeof item === "object" && typeof (item as E2eToolCall).name === "string",
      )
      .slice(0, 10)
      .map((item) => ({ name: item.name, input: (item.input ?? {}) as Record<string, unknown> }));
  } catch {
    return [];
  }
}

type ScriptParams = Pick<Anthropic.MessageStreamParams, "messages" | "tools">;

/** What the stand-in answers: the script's tool calls first, then a line about their results. */
export function scriptedAnswer(params: ScriptParams, script: E2eToolCall[]): Anthropic.Message {
  const last = params.messages.at(-1);
  const results =
    last && Array.isArray(last.content)
      ? last.content.filter(
          (block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result",
        )
      : [];
  const offered = new Set((params.tools ?? []).map((tool) => ("name" in tool ? tool.name : "")));
  const base = {
    id: "msg_e2e",
    type: "message" as const,
    role: "assistant" as const,
    model: "e2e",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const text = (value: string) =>
    ({
      ...base,
      stop_reason: "end_turn",
      content: [{ type: "text", text: value, citations: null }],
    }) as unknown as Anthropic.Message;
  if (results.length) {
    const statuses = results.map((block) => {
      const content = typeof block.content === "string" ? block.content : "";
      const status =
        /"status":"([a-z_]+)"/.exec(content)?.[1] ??
        /"error":"([a-zA-Z_]+)"/.exec(content)?.[1] ??
        "?";
      return status;
    });
    return text(`${E2E_TOOLS_TEXT}: ${statuses.join(", ")}`);
  }
  const usable = script.filter((call) => offered.has(call.name));
  const missing = script.filter((call) => !offered.has(call.name)).map((call) => call.name);
  if (!usable.length) return text(`${E2E_TOOLS_TEXT}: not offered: ${missing.join(", ") || "-"}`);
  return {
    ...base,
    stop_reason: "tool_use",
    content: usable.map((call, index) => ({
      type: "tool_use",
      id: `toolu_e2e_${index}`,
      name: call.name,
      input: call.input,
    })),
  } as unknown as Anthropic.Message;
}

/** A client that plays the script through the same streaming interface the loop reads. */
export function e2eToolClient(admin: SupabaseClient<Database>, script: E2eToolCall[]): GradyClient {
  const stream = (params: Anthropic.MessageStreamParams) => {
    const message = scriptedAnswer(params, script);
    async function* events() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      } as unknown as Anthropic.MessageStreamEvent;
      for (const [index, block] of message.content.entries()) {
        if (block.type === "text") {
          yield {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: block.text },
          } as Anthropic.MessageStreamEvent;
        } else if (block.type === "tool_use") {
          yield {
            type: "content_block_start",
            index,
            content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
          } as unknown as Anthropic.MessageStreamEvent;
        }
      }
      yield {
        type: "message_delta",
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage: { output_tokens: 0 },
      } as unknown as Anthropic.MessageStreamEvent;
    }
    const iterator = events();
    return Object.assign(iterator, { finalMessage: async () => message });
  };
  return {
    messages: { stream } as unknown as Anthropic["messages"],
    budget: createBudgetGuard(admin),
  };
}

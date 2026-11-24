import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelChoice } from "../../model-settings";
import { EMPTY_USAGE, maxTokensFor, modelFor, type GradyModel, type TokenUsage } from "../../models";
import { GRADY_PERSONA } from "../../prompt";
import type { ChatErrorCode } from "../../protocol";
import { modelToolOf } from "../../tools/catalog";
import type { AnyTool } from "../../tools/types";
import { creditErrorCode, errorCode, planCall, type ModelCall } from "../model";
import { cacheConversation } from "../../cache";
import { BULK_THRESHOLD, WRITES_PER_MESSAGE, type StepResult, type ToolCall } from "./actions";

/**
 * The chat with tools: the model answers, calls tools, reads their results
 * and goes on, at most MAX_TOOL_ROUNDS times, then writes its last answer
 * without tools. Every round is one model call: checked against the budget
 * first and written to ai_usage (feature chat) when it ends, like any call.
 */

export const MAX_TOOL_ROUNDS = 8;

export type ToolLoopCall = Omit<ModelCall, "feature"> & {
  tools: AnyTool[];
  /** Runs one call of a tool (read, instant change, or a proposal to confirm). */
  runTool: (call: ToolCall) => Promise<StepResult>;
  /** Gathers changes beyond the threshold into one proposal. */
  runBulk: (calls: ToolCall[]) => Promise<StepResult>;
  /** The tool the model is about to use, for "Creating the task…". */
  onTool?: (name: string) => void;
  /** Its result (a card, when it changed something or waits for Confirm). */
  onStep?: (step: StepResult) => void;
};

export type ToolLoopResult =
  | { ok: true; model: GradyModel; text: string; tokens: TokenUsage; rounds: number }
  | {
      ok: false;
      model: GradyModel;
      code: ChatErrorCode;
      text: string;
      tokens: TokenUsage;
      rounds: number;
    };

type StreamLike = AsyncIterable<Anthropic.MessageStreamEvent> & {
  finalMessage: () => Promise<Anthropic.Message>;
};

function add(total: TokenUsage, part: TokenUsage) {
  total.inputTokens += part.inputTokens;
  total.cacheReadTokens += part.cacheReadTokens;
  total.cacheWriteTokens += part.cacheWriteTokens;
  total.outputTokens += part.outputTokens;
}

function isWrite(tools: Map<string, AnyTool>, name: string) {
  return tools.get(name)?.kind === "write";
}

/** The text of the latest user message (its text blocks when it carries files). */
export function lastUserText(messages: readonly Anthropic.MessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ");
  }
  return "";
}

export async function streamWithTools(call: ToolLoopCall): Promise<ToolLoopResult> {
  const feature = "chat" as const;
  // The model is chosen once per message (the setting, the automatic choice
  // or economy mode) and kept for every round: a round reads the last one's
  // thinking, which only the same model can.
  let choice: ModelChoice | null = null;
  let model: GradyModel = modelFor(feature);
  const total: TokenUsage = { ...EMPTY_USAGE };
  const byName = new Map(call.tools.map((tool) => [tool.name, tool]));
  const modelTools = call.tools.map(modelToolOf);
  const messages: Anthropic.MessageParam[] = [...call.messages];
  let text = "";
  let writes = 0;
  let instantWrites = 0;
  let rounds = 0;
  // Decided once for the message: it asks for a tool, so further rounds are likely.
  const cacheRounds = cacheConversation(modelTools.length > 0, lastUserText(call.messages));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (!choice) {
      const plan = await planCall({ ...call, feature });
      if (!plan.ok) {
        return { ok: false, model: plan.model, code: plan.code, text, tokens: total, rounds };
      }
      choice = plan.choice;
      model = choice.model.id;
    } else {
      const verdict = call.client.budget
        ? await call.client.budget.check(feature, call.userId)
        : "ok";
      if (verdict !== "ok") return { ok: false, model, code: verdict, text, tokens: total, rounds };
    }
    const routedFrom = choice.routedFrom;

    // The last round has no tools left: the model answers with what it has.
    const lastRound = round === MAX_TOOL_ROUNDS;
    const tokens: TokenUsage = { ...EMPTY_USAGE };
    const started = Date.now();
    const params: Anthropic.MessageStreamParams = {
      model,
      max_tokens: maxTokensFor(feature, model),
      // The tools come before the system prompt, so the cached prefix covers them too.
      ...(modelTools.length
        ? { tools: modelTools, tool_choice: lastRound ? { type: "none" } : { type: "auto" } }
        : {}),
      system: [
        {
          type: "text",
          text: call.instructions ?? GRADY_PERSONA,
          cache_control: { type: "ephemeral" },
        },
        ...(call.context ? [{ type: "text" as const, text: call.context }] : []),
      ],
      messages,
      // Step 28.9: the conversation is cached too (automatic caching moves the
      // breakpoint to the end of the messages), so every further round reads
      // the context, the history and the earlier rounds for a tenth of the
      // price or less instead of paying them again (cache.ts, measured in
      // scripts/ai-savings.ts).
      ...(cacheRounds ? { cache_control: { type: "ephemeral" as const } } : {}),
      // Haiku answers without thinking first (as streamModel does), so it
      // never spends its token budget thinking and returns an empty answer.
      ...(choice.model.thinkingOff ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: modelTools.length ? "medium" : "low" },
    };

    let message: Anthropic.Message;
    try {
      const stream = call.client.messages.stream(params) as unknown as StreamLike;
      let roundText = "";
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
            break;
          case "content_block_start":
            if (event.content_block.type === "tool_use") call.onTool?.(event.content_block.name);
            break;
          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              // Text after a tool round starts on its own line.
              const piece =
                !roundText && text && !text.endsWith("\n")
                  ? `\n\n${event.delta.text}`
                  : event.delta.text;
              roundText += event.delta.text;
              text += piece;
              call.onText?.(piece);
            }
            break;
        }
      }
      message = await stream.finalMessage();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`grady chat (tools) on ${model} failed: ${reason}`);
      add(total, tokens);
      await call.log({
        feature,
        model,
        routedFrom,
        tokens,
        durationMs: Date.now() - started,
        error: reason,
      });
      const credit = creditErrorCode(error);
      if (credit) await call.client.budget?.creditsExhausted(feature, credit);
      return { ok: false, model, code: errorCode(error), text, tokens: total, rounds };
    }
    add(total, tokens);
    await call.log({ feature, model, routedFrom, tokens, durationMs: Date.now() - started });

    const uses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (message.stop_reason !== "tool_use" || !uses.length || lastRound) {
      if (!text.trim() && !rounds)
        return { ok: false, model, code: "unavailable", text, tokens: total, rounds };
      return { ok: true, model, text, tokens: total, rounds };
    }

    rounds += 1;
    // The answer goes back whole (thinking included), then every result in one message.
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    const writesHere = uses.filter((use) => isWrite(byName, use.name));
    const bulk = writesHere.length > BULK_THRESHOLD;
    const deferred: { id: string; call: ToolCall }[] = [];
    for (const use of uses) {
      const toolCall: ToolCall = { name: use.name, input: use.input };
      const write = isWrite(byName, use.name);
      if (write) {
        writes += 1;
        if (writes > WRITES_PER_MESSAGE) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: JSON.stringify({
              error: "writeLimit",
              message: `At most ${WRITES_PER_MESSAGE} changes per message.`,
            }),
          });
          continue;
        }
        const instant = byName.get(use.name)?.risk === "instant";
        if (bulk || (instant && instantWrites >= BULK_THRESHOLD)) {
          deferred.push({ id: use.id, call: toolCall });
          continue;
        }
        if (instant) instantWrites += 1;
      }
      const step = await call.runTool(toolCall);
      call.onStep?.(step);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        is_error: step.isError,
        content: step.content,
      });
    }
    if (deferred.length) {
      const step = await call.runBulk(deferred.map((item) => item.call));
      call.onStep?.(step);
      for (const item of deferred) {
        results.push({
          type: "tool_result",
          tool_use_id: item.id,
          is_error: step.isError,
          content: step.content,
        });
      }
    }
    // Results in the order of the calls.
    const order = new Map(uses.map((use, index) => [use.id, index]));
    results.sort((a, b) => (order.get(a.tool_use_id) ?? 0) - (order.get(b.tool_use_id) ?? 0));
    messages.push({ role: "user", content: results });
  }
  return { ok: true, model, text, tokens: total, rounds };
}

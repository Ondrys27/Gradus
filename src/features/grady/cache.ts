/**
 * Prompt caching beyond the persona (step 28.9). Pure: when the chat caches
 * its conversation, and what a chat message costs with and without it, so
 * the decision and the savings in docs/grady-pravidla.md can be checked
 * (Vitest, scripts/ai-savings.ts).
 *
 * Every call caches its fixed instructions (the persona or a job's own
 * prompt, with the tool definitions in front of them). The chat with tools
 * also caches the conversation: automatic caching (a top-level
 * cache_control) puts the breakpoint on the last message, so the next round
 * of the same message (after a tool result) reads the context, the history
 * and the earlier rounds from the cache instead of paying them again. A
 * cache write costs 1.25× input, a read 0.1× (Haiku) or 0.05× (Sonnet,
 * Opus): one more round already pays for the write.
 */
import { costUsd, type GradyModel } from "./models";

/**
 * Words of a message that asks Grady to look something up or change it: such
 * a message usually takes two rounds or more (a tool, then the answer).
 */
const TOOL_WORDS = [
  "zaloz",
  "pridej",
  "vytvor",
  "uloz",
  "zapis",
  "smaz",
  "odstran",
  "presun",
  "oznac",
  "odskrtni",
  "dokonci",
  "zmen",
  "uprav",
  "nastav",
  "najdi",
  "vyhledej",
  "ukaz",
  "vypis",
  "seznam",
  "ktere",
  "ktery",
  "kolik mam",
  "dej mi to",
  "dej to",
  "posli",
  "prirad",
  "vystav",
  "create",
  "add ",
  "delete",
  "remove",
  "move",
  "mark",
  "update",
  "change",
  "find",
  "show me",
  "list",
  "which",
  "schedule",
  "assign",
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Whether the message asks for something the tools do (look up, create, change). */
export function likelyToolUse(message: string): boolean {
  const text = ` ${normalize(message)} `;
  return TOOL_WORDS.some((word) => text.includes(word.startsWith(" ") ? word : ` ${word}`));
}

/**
 * The chat caches its conversation when it offers tools and the message
 * asks for something the tools do: then it usually runs two rounds or more,
 * and one more round already pays for the cache write (measured in
 * scripts/ai-savings.ts). A message answered in one round would pay the
 * write premium for nothing, so the others stay as they were.
 */
export function cacheConversation(hasTools: boolean, message = ""): boolean {
  return hasTools && likelyToolUse(message);
}

export type ChatMessageShape = {
  model: GradyModel;
  /** Tool definitions and instructions: cached on every call already (read after the first). */
  fixedTokens: number;
  /** Context and history of the message (the part after the cached instructions). */
  contextTokens: number;
  /** What each further round adds: the assistant's tool call and the tool results. */
  perRoundTokens: number;
  /** Rounds of the message: 1 = answered without tools. */
  rounds: number;
  /** Output tokens of each round. */
  outputTokens: number;
};

/**
 * What one chat message costs over all its rounds, with the instructions
 * read from the cache, and the conversation cached (`cached`) or not.
 */
export function chatMessageCost(shape: ChatMessageShape, cached: boolean): number {
  let total = 0;
  let prompt = shape.contextTokens;
  let written = 0;
  for (let round = 1; round <= shape.rounds; round++) {
    const fresh = cached ? prompt - written : prompt;
    total += costUsd(shape.model, {
      inputTokens: cached ? 0 : fresh,
      cacheReadTokens: shape.fixedTokens + (cached ? written : 0),
      cacheWriteTokens: cached ? fresh : 0,
      outputTokens: shape.outputTokens,
    });
    written = prompt;
    prompt += shape.perRoundTokens;
  }
  return total;
}

/** The saving of caching the conversation as a share of the cost without it (negative = it costs more). */
export function conversationCacheSaving(shape: ChatMessageShape): number {
  const before = chatMessageCost(shape, false);
  if (before <= 0) return 0;
  return (before - chatMessageCost(shape, true)) / before;
}

import type Anthropic from "@anthropic-ai/sdk";

export type StoredMessage = { role: "user" | "assistant"; content: string };

/**
 * History for the model: oldest first and starting with the user, as the API
 * requires. A turn left without an answer (a failed call) sits next to the
 * following user message, which the API reads as one turn.
 */
export function toModelMessages(rows: StoredMessage[]): Anthropic.MessageParam[] {
  const firstUser = rows.findIndex((row) => row.role === "user");
  if (firstUser === -1) return [];
  return rows.slice(firstUser).map((row) => ({ role: row.role, content: row.content }));
}

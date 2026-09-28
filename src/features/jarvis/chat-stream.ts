import type { ChatEvent } from "./protocol";

/**
 * Reads the answer of POST /api/jarvis: NDJSON lines while streaming, or a
 * single JSON error when the request was refused before. A stream that ends
 * without done or error was cut off and reads as a network error.
 */
export async function readChatStream(
  response: Response,
  onEvent: (event: ChatEvent) => void,
): Promise<ChatEvent> {
  const isStream = response.headers.get("Content-Type")?.includes("ndjson");
  if (!isStream || !response.body) {
    const body = (await response.json().catch(() => null)) as ChatEvent | null;
    const event: ChatEvent = body?.type === "error" ? body : { type: "error", code: "unknown" };
    onEvent(event);
    return event;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let last: ChatEvent | null = null;
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        last = JSON.parse(line) as ChatEvent;
        onEvent(last);
      } catch {
        /* a broken line is skipped; the final event still decides */
      }
    }
    if (done) break;
  }

  if (!last || (last.type !== "done" && last.type !== "error")) {
    const event: ChatEvent = { type: "error", code: "network" };
    onEvent(event);
    return event;
  }
  return last;
}

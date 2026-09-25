"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { GenerateInput, GenerationEvent, GenerationUsage } from "./generation";

const ENDPOINT = "/api/generate-contacts";

export const generationKeys = {
  usage: (userId: string) => ["contacts", userId, "generation-usage"] as const,
};

/** Plan allowance used today and this month; only the server can read it. */
export function useGenerationUsage(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: generationKeys.usage(user.id),
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<{ usage: GenerationUsage; max: number }> => {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`usage ${response.status}`);
      return response.json();
    },
  });
}

/**
 * Runs a generation and reports every progress line. Resolves with the last
 * event: done, or an error (refusals before the search answer as a single event too).
 */
export async function runGeneration(
  input: GenerateInput,
  onEvent: (event: GenerationEvent) => void,
): Promise<GenerationEvent> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    const event: GenerationEvent = { type: "error", code: "network", created: 0 };
    onEvent(event);
    return event;
  }

  const isStream = response.headers.get("Content-Type")?.includes("ndjson");
  if (!isStream || !response.body) {
    const body = (await response.json().catch(() => null)) as GenerationEvent | null;
    const event: GenerationEvent =
      body?.type === "error" ? body : { type: "error", code: "unknown", created: 0 };
    onEvent(event);
    return event;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let last: GenerationEvent | null = null;
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        last = JSON.parse(line) as GenerationEvent;
        onEvent(last);
      } catch {
        /* a broken line is skipped; the final event still decides */
      }
    }
    if (done) break;
  }

  if (!last || last.type === "phase") {
    // The connection ended before the server finished.
    const event: GenerationEvent = {
      type: "error",
      code: "network",
      created: last?.type === "phase" ? last.created : 0,
    };
    onEvent(event);
    return event;
  }
  return last;
}

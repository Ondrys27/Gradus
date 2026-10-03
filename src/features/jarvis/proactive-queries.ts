"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { ProactiveRequest, ProactiveResponse } from "./protocol";
import { jarvisKeys } from "./queries";

const ENDPOINT = "/api/jarvis";

/** What Jarvis would bring up now; nothing (and no retry hint) when the request fails. */
export async function fetchProactive(): Promise<ProactiveResponse> {
  try {
    const response = await fetch(`${ENDPOINT}?view=proactive`, { cache: "no-store" });
    if (!response.ok) return { item: null, retryAt: null };
    return (await response.json()) as ProactiveResponse;
  } catch {
    return { item: null, retryAt: null };
  }
}

export class ProactiveError extends Error {}

/**
 * Tells the server what happened with the bubble: it was shown, or the user
 * opened, added, answered, postponed or closed it. The server logs each one.
 */
export function useProactiveReaction() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: Omit<ProactiveRequest, "kind">) => {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "proactive", ...request }),
      });
      const body = (await response.json().catch(() => null)) as
        { ok: true; created: number } | { ok: false } | null;
      if (!body?.ok) throw new ProactiveError(`proactive ${response.status}`);
      return body.created;
    },
    onSuccess: (created, request) => {
      if (request.reaction === "shown") return;
      // The panel's list and its unseen count follow the bubble.
      void queryClient.invalidateQueries({ queryKey: jarvisKeys.suggestions(user.id) });
      if (created > 0) {
        void queryClient.invalidateQueries({ queryKey: ["milestones", user.id] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] });
      }
    },
  });
}

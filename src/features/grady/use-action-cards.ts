"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { useAwardXp, useGameCelebrate } from "@/features/game/queries";
import type { ActionCard } from "./actions";
import type { ActionDecisionResult } from "./protocol";
import { gradyKeys, postGradyJob, type Conversation } from "./queries";

/**
 * After Grady changed something: the sections it touched are read again
 * (TanStack Query) and the XP and celebrations come exactly as when the user
 * does it by hand (award_xp decides the amount and pays once).
 */
export function useApplyActionCard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const awardXp = useAwardXp();
  const celebrate = useGameCelebrate();
  const tMilestones = useTranslations("milestones");
  const tPipeline = useTranslations("pipeline");
  return useCallback(
    (card: ActionCard, { awards }: { awards: boolean }) => {
      for (const root of card.invalidate) {
        void queryClient.invalidateQueries({ queryKey: [root, user.id] });
      }
      // A finished milestone or a won deal is also one of Grady's instant triggers.
      void queryClient.invalidateQueries({ queryKey: gradyKeys.suggestions(user.id) });
      if (!awards) return;
      for (const award of card.awards) {
        const moment = award.celebrate?.moment;
        const celebration = moment
          ? (xp?: number) => ({
              title:
                moment === "milestone"
                  ? tMilestones("celebration.title")
                  : tPipeline("celebration.title"),
              subtitle: award.celebrate!.subtitle,
              reward: award.celebrate!.reward
                ? tMilestones("celebration.reward", { reward: award.celebrate!.reward })
                : undefined,
              xp,
            })
          : null;
        awardXp.mutate(
          {
            reason: award.reason,
            refId: award.refId,
            ...(celebration
              ? { celebration: ({ awarded, xp }) => celebration(awarded ? xp : undefined), moment }
              : {}),
          },
          // The change is made either way; a failed award still celebrates it.
          { onError: () => celebration && moment && celebrate(celebration(), moment) },
        );
      }
    },
    [queryClient, user.id, awardXp, celebrate, tMilestones, tPipeline],
  );
}

/** Puts a card's new state into the cached conversation, wherever it sits. */
function replaceCard(
  conversation: Conversation | undefined,
  card: ActionCard,
): Conversation | undefined {
  if (!conversation) return conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.actions?.some((item) => item.id === card.id)
        ? {
            ...message,
            actions: message.actions.map((item) => (item.id === card.id ? card : item)),
          }
        : message,
    ),
  };
}

export type ActionDecision = "confirmAction" | "rejectAction" | "undoAction";

export class ActionDecisionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ActionDecisionError";
  }
}

/** Confirm, Cancel or Undo on a card; the server checks the action, the right and the input again. */
export function useDecideAction() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const apply = useApplyActionCard();
  return useMutation({
    mutationFn: async ({ kind, id }: { kind: ActionDecision; id: string }) => {
      const result = await postGradyJob<{ card: ActionCard }>({ kind, id });
      const card = (result as ActionDecisionResult).card;
      if (card) {
        queryClient.setQueryData<Conversation>(gradyKeys.conversation(user.id), (current) =>
          replaceCard(current, card),
        );
      }
      if (!result.ok) throw new ActionDecisionError(result.code);
      return { kind, card: result.card };
    },
    onSuccess: ({ kind, card }) => {
      // A confirmed change pays like a change made by hand; an undo only refreshes.
      if (kind !== "rejectAction") apply(card, { awards: kind === "confirmAction" });
    },
  });
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { industryKeyOf } from "@/features/onboarding/industries";
import type { Json } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { runCheck, type CheckContext } from "./checks";
import { useExchangeRates } from "@/features/currency/use-exchange-rates";
import { buildDemoPayload } from "./demo-data";
import { CHECK_INTERVAL_MS } from "./engine";
import { subscribeTutorialSignals } from "./signals";
import type { TutorialStep } from "./steps";
import { parseTutorialState, type TutorialState } from "./types";

export const tutorialKeys = {
  demo: (userId: string) => ["tutorial", userId, "demo"] as const,
};

/** The stored choice and progress, or null before the first choice. */
export function useTutorialState(): TutorialState | null {
  const profile = useProfile();
  return useMemo(() => parseTutorialState(profile.tutorial), [profile.tutorial]);
}

/** Stores the state on the profile; an end also stamps tour_completed_at (Jarvis waits for it). */
export function useSaveTutorial() {
  const update = useUpdateProfile();
  return useMemo(
    () => ({
      save: (state: TutorialState) =>
        update.mutateAsync({
          tutorial: state as unknown as Json,
          ...(state.finished_at ? { tour_completed_at: state.finished_at } : {}),
        }),
    }),
    [update],
  );
}

/**
 * Puts the sample data into the user's own space (tutorial_seed_demo, which
 * marks every row); resolves with the database's time of the seeding, from
 * which the tutorial's checks count. Every list reads again afterwards.
 */
export function useSeedDemo() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const settings = useFormatSettings();
  const t = useTranslations("tutorial.demo");
  const template = useTranslations("notes.templates");
  const rates = useExchangeRates();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const payload = buildDemoPayload({
        industry: industryKeyOf(profile.industry),
        settings,
        now: new Date(),
        t: (key, values) => t(key, values),
        template: (key) => template(key),
        rates,
      });
      const { data, error } = await createClient().rpc("tutorial_seed_demo", {
        _payload: payload as unknown as Json,
      });
      if (error) throw error;
      const seededAt = (data as { seeded_at?: unknown } | null)?.seeded_at;
      return typeof seededAt === "string" ? seededAt : new Date().toISOString();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "account",
      });
      void queryClient.invalidateQueries({ queryKey: tutorialKeys.demo(user.id) });
    },
  });
}

/** Deletes every sample row and what hangs only on it (tutorial_delete_demo). */
export function useDeleteDemo() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("tutorial_delete_demo");
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "account",
      });
      queryClient.setQueryData(tutorialKeys.demo(user.id), false);
    },
  });
}

/** Whether the user's own space still holds sample data (Settings → Jarvis offers to delete it). */
export function useHasDemoData(enabled: boolean) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: tutorialKeys.demo(user.id),
    enabled: enabled && workspaceId === user.id,
    queryFn: async () => {
      const supabase = createClient();
      const head = { count: "exact", head: true } as const;
      const results = await Promise.all(
        (["contacts", "deals", "milestones", "notes"] as const).map((table) =>
          supabase.from(table).select("id", head).eq("user_id", user.id).eq("is_demo", true),
        ),
      );
      for (const result of results) if (result.error) throw result.error;
      return results.some((result) => (result.count ?? 0) > 0);
    },
  });
}

/**
 * Whether the current hands-on step is done: looked up when it begins, every
 * few seconds, after every change the app saves and on every signal from a
 * screen, until it passes. A look step is done at once.
 */
export function useStepCheck(step: TutorialStep | null, since: string | null): boolean {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [passed, setPassed] = useState<{ key: string; done: boolean } | null>(null);
  const running = useRef(false);
  const check = step?.action === "do" ? step.check : null;
  const stepKey = step?.key ?? null;

  useEffect(() => {
    if (!check || !stepKey || !since) return;
    let stopped = false;
    const context: CheckContext = { workspaceId, userId: user.id, since };
    const look = async () => {
      if (running.current || stopped) return;
      running.current = true;
      try {
        const done = await runCheck(check, context, createClient());
        if (stopped) return;
        setPassed({ key: stepKey, done });
        if (done) stop();
      } finally {
        running.current = false;
      }
    };
    const soon = () => window.setTimeout(() => void look(), 400);
    const interval = window.setInterval(() => void look(), CHECK_INTERVAL_MS);
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") soon();
    });
    const unsubscribeSignals = subscribeTutorialSignals(() => void look());
    const onFocus = () => void look();
    window.addEventListener("focus", onFocus);
    function stop() {
      stopped = true;
      window.clearInterval(interval);
      unsubscribeMutations();
      unsubscribeSignals();
      window.removeEventListener("focus", onFocus);
    }
    void look();
    return stop;
  }, [check, stepKey, since, workspaceId, user.id, queryClient]);

  if (!step || step.action === "look") return true;
  return passed?.key === step.key && passed.done;
}

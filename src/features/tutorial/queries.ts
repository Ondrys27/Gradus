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
  space: (userId: string, space: string) => ["tutorial", userId, "space", space] as const,
};

/** A company's tutorial of a worker (space_tutorials, 30.2); null before the first choice there. */
type SpaceTutorial = { state: TutorialState | null; knownSections: string[] | null } | null;

function useSpaceTutorial(enabled: boolean) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: tutorialKeys.space(user.id, space),
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<SpaceTutorial> => {
      const { data, error } = await createClient()
        .from("space_tutorials")
        .select("state, known_sections")
        .eq("user_id", user.id)
        .eq("space_id", space)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { state: parseTutorialState(data.state), knownSections: data.known_sections ?? null }
        : null;
    },
  });
}

export type TutorialStore = {
  /** The stored choice and progress, or null before the first choice. */
  state: TutorialState | null;
  /** False while a company's tutorial is still being read: nothing starts before. */
  ready: boolean;
  /**
   * The sections a worker was shown (or offered) in this company; null before
   * that, and always in the account's own space.
   */
  knownSections: string[] | null;
};

/**
 * The tutorial of the open space: the account's own on the profile
 * (profiles.tutorial), each company it works for apart (space_tutorials), so
 * a worker gets the tutorial of their rights after their first entry into
 * every company.
 */
export function useTutorialState(): TutorialStore {
  const profile = useProfile();
  const { worker } = useSession();
  const company = useSpaceTutorial(Boolean(worker));
  const own = useMemo(() => parseTutorialState(profile.tutorial), [profile.tutorial]);
  if (!worker) return { state: own, ready: true, knownSections: null };
  return {
    state: company.data?.state ?? null,
    ready: company.isSuccess,
    knownSections: company.data?.knownSections ?? null,
  };
}

/**
 * Stores the state: on the profile in the account's own space (an end also
 * stamps tour_completed_at, which Grady waits for), in space_tutorials in a
 * company. `knownSections` (a company only) remembers what was introduced.
 */
export function useSaveTutorial() {
  const update = useUpdateProfile();
  const { user, worker } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMemo(() => {
    const saveSpace = async (patch: { state?: TutorialState; knownSections?: string[] }) => {
      const row = {
        user_id: user.id,
        space_id: space,
        ...(patch.state ? { state: patch.state as unknown as Json } : {}),
        ...(patch.knownSections ? { known_sections: patch.knownSections } : {}),
      };
      const { error } = await createClient()
        .from("space_tutorials")
        .upsert(row, { onConflict: "user_id,space_id" });
      if (error) throw error;
      queryClient.setQueryData<SpaceTutorial>(tutorialKeys.space(user.id, space), (current) => ({
        state: patch.state ?? current?.state ?? null,
        knownSections: patch.knownSections ?? current?.knownSections ?? null,
      }));
    };
    return {
      save: async (state: TutorialState) => {
        if (worker) return saveSpace({ state });
        await update.mutateAsync({
          tutorial: state as unknown as Json,
          ...(state.finished_at ? { tour_completed_at: state.finished_at } : {}),
        });
      },
      saveKnownSections: async (sections: string[]) => {
        if (worker) await saveSpace({ knownSections: sections });
      },
    };
  }, [update, worker, user.id, space, queryClient]);
}

/**
 * Puts the sample data into the user's own space (tutorial_seed_demo, which
 * marks every row) or, for a worker, into the company only in the sections
 * their rights open (tutorial_seed_worker_demo, 30.2); resolves with the
 * database's time of the seeding, from which the tutorial's checks count.
 * Every list reads again afterwards.
 */
export function useSeedDemo() {
  const { user, worker } = useSession();
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
      const { data, error } = await createClient().rpc(
        worker ? "tutorial_seed_worker_demo" : "tutorial_seed_demo",
        { _payload: payload as unknown as Json },
      );
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

/**
 * Deletes every sample row and what hangs only on it (tutorial_delete_demo);
 * in a company only what this worker's tutorial put there (tutorial_delete_worker_demo).
 */
export function useDeleteDemo() {
  const { user, worker } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc(
        worker ? "tutorial_delete_worker_demo" : "tutorial_delete_demo",
      );
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

/** Whether the user's own space still holds sample data (Settings → Grady offers to delete it). */
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
  const { user, worker } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [passed, setPassed] = useState<{ key: string; done: boolean } | null>(null);
  const running = useRef(false);
  const check = step?.action === "do" ? step.check : null;
  const stepKey = step?.key ?? null;

  useEffect(() => {
    if (!check || !stepKey || !since) return;
    let stopped = false;
    const context: CheckContext = { workspaceId, userId: user.id, since, worker: Boolean(worker) };
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
  }, [check, stepKey, since, workspaceId, user.id, worker, queryClient]);

  if (!step || step.action === "look") return true;
  return passed?.key === step.key && passed.done;
}

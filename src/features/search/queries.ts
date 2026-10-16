"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import {
  readRecentItems,
  searchParams,
  searchPlan,
  shouldQueryDatabase,
  type DbKind,
  type RecentItem,
} from "./search-logic";

export type SearchHit = {
  kind: DbKind;
  id: string;
  title: string;
  rank: number;
  data: Record<string, unknown>;
};

export const searchKeys = {
  results: (userId: string, query: string, kinds: readonly DbKind[] | null) =>
    ["search", userId, "results", query, kinds] as const,
  history: (userId: string) => ["search", userId, "history"] as const,
};

/**
 * One search with the signed-in user's own client, so row level security
 * decides what comes back: `global_search()` for everything but notes and
 * `search_notes()` for the user's own notes, side by side. A newer query
 * aborts the one still running (TanStack Query aborts the signal of a query
 * nobody watches anymore).
 */
export function useGlobalSearch(query: string, kinds: readonly DbKind[] | null) {
  const { user, worker } = useSession();
  return useQuery({
    queryKey: searchKeys.results(user.id, query, kinds),
    queryFn: async ({ signal }) => {
      const params = searchParams(query, kinds ?? undefined);
      const plan = searchPlan(params._kinds, !worker);
      const supabase = createClient();
      const [global, notes] = await Promise.all([
        plan.globalKinds === null || plan.globalKinds.length > 0
          ? supabase
              .rpc("global_search", {
                _query: params._query,
                _phone_patterns: params._phone_patterns,
                _limit: params._limit,
                // The generated type misses that these two are nullable.
                _amount: params._amount as unknown as number,
                _kinds: plan.globalKinds as unknown as string[],
              })
              .abortSignal(signal)
          : null,
        plan.notes
          ? supabase
              .rpc("search_notes", { _query: params._query, _limit: params._limit })
              .abortSignal(signal)
          : null,
      ]);
      if (global?.error) throw global.error;
      if (notes?.error) throw notes.error;
      return [
        ...((global?.data ?? []) as SearchHit[]),
        ...(notes?.data ?? []).map(
          (hit): SearchHit => ({
            kind: "note",
            id: hit.id,
            title: hit.title,
            rank: hit.rank,
            data: (hit.data ?? {}) as Record<string, unknown>,
          }),
        ),
      ];
    },
    enabled: shouldQueryDatabase(query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

export type SearchHistory = { searches: string[]; items: RecentItem[] };

const EMPTY_HISTORY: SearchHistory = { searches: [], items: [] };

/** Recent searches and opened results, kept in the user's settings row. */
export function useSearchHistory(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: searchKeys.history(user.id),
    queryFn: async (): Promise<SearchHistory> => {
      const { data, error } = await createClient()
        .from("user_settings")
        .select("recent_searches, recent_search_items")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return {
        searches: (data.recent_searches ?? []).filter((q) => typeof q === "string"),
        items: readRecentItems(data.recent_search_items),
      };
    },
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

/** Saves the new lists; shown at once, and a failed save only loses the history entry. */
export function useSaveSearchHistory() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = searchKeys.history(user.id);
  return useMutation({
    mutationFn: async (next: SearchHistory) => {
      const { error } = await createClient()
        .from("user_settings")
        .update({ recent_searches: next.searches, recent_search_items: next.items })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onMutate: (next) => {
      const previous = queryClient.getQueryData<SearchHistory>(key) ?? EMPTY_HISTORY;
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
  });
}

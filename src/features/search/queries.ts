"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import {
  readRecentItems,
  searchParams,
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
 * One call of `global_search()` with the signed-in user's own client, so row
 * level security decides what comes back. A newer query aborts the one still
 * running (TanStack Query aborts the signal of a query nobody watches anymore).
 */
export function useGlobalSearch(query: string, kinds: readonly DbKind[] | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: searchKeys.results(user.id, query, kinds),
    queryFn: async ({ signal }) => {
      const { data, error } = await createClient()
        .rpc("global_search", searchParams(query, kinds ?? undefined))
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as SearchHit[];
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

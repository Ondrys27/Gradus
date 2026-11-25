"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { WidgetQuery, WidgetSettings } from "@/features/widgets/kit";
import { ADMIN_REFRESH_MS } from "../view-state";
import { adminWidgetMeta } from "./catalog";
import type { AdminWidgetData } from "./data";
import { widgetViewQuery } from "./period";

/** How often the widgets that watch what is happening now refresh (29.2). */
export const LIVE_REFRESH_MS = 60_000;

export const adminWidgetKeys = {
  all: ["admin-widgets"] as const,
  one: (key: string, view: string) => ["admin-widgets", key, view] as const,
};

async function fetchWidget(key: string, view: string): Promise<AdminWidgetData> {
  const response = await fetch(`/api/admin/widgets/${key}${view ? `?${view}` : ""}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`widget ${key}: ${response.status}`);
  return (await response.json()) as AdminWidgetData;
}

/**
 * The data of one widget of the overview, for the top bar's view (or the
 * widget's own period). Errors, health, new users and revenue refresh every
 * minute while the tab is visible, the others at the administration's usual
 * pace; a hidden tab asks for nothing (TanStack Query pauses intervals).
 * The same widget twice on a board, or in the gallery, shares one request.
 */
export function useAdminWidgetData(key: string, settings: WidgetSettings): WidgetQuery<AdminWidgetData> {
  const searchParams = useSearchParams();
  const meta = adminWidgetMeta(key);
  const view = widgetViewQuery(searchParams.toString(), meta?.period ? settings.period : "bar");
  const query = useQuery({
    queryKey: adminWidgetKeys.one(key, view),
    queryFn: () => fetchWidget(key, view),
    refetchInterval: meta?.live ? LIVE_REFRESH_MS : ADMIN_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: meta?.live ? LIVE_REFRESH_MS / 2 : 60_000,
    retry: 1,
  });
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

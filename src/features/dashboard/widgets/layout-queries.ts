"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";
import { cleanItems, MAX_LAYOUTS, withPositions, type LayoutItem } from "./grid";

/**
 * The dashboards of the signed-in person in the active space (28.5): their
 * tabs (dashboard_layouts, own rows only) and what applies to them there
 * (dashboard_context: the owner's default for them and the widgets they may
 * use). Everything goes through the user's client and row level security.
 */

export type DefaultSource = "space" | "group" | "worker";

export type StoredLayout = {
  id: string;
  /** Null for the main tab: shown as "Dashboard" in the user's language. */
  name: string | null;
  position: number;
  /** Null: the main tab follows the default live. */
  items: LayoutItem[] | null;
  isDefault: boolean;
  basedOn: string | null;
};

export type DashboardContext = {
  source: DefaultSource | null;
  groupName: string | null;
  items: LayoutItem[] | null;
  updatedAt: string | null;
  /** Widgets the owner lets this worker use; null = all they have data for. */
  allowed: string[] | null;
};

export const dashboardLayoutKeys = {
  all: (userId: string) => ["dashboard-layouts", userId] as const,
  layouts: (userId: string, space: string) => ["dashboard-layouts", userId, space, "own"] as const,
  context: (userId: string, space: string) =>
    ["dashboard-layouts", userId, space, "context"] as const,
  defaults: (userId: string) => ["dashboard-layouts", userId, "defaults"] as const,
  allowed: (userId: string, workerId: string) =>
    ["dashboard-layouts", userId, "allowed", workerId] as const,
};

const LAYOUT_COLUMNS = "id, name, position, items, is_default, based_on" as const;

function toLayout(row: {
  id: string;
  name: string | null;
  position: number;
  items: Json | null;
  is_default: boolean;
  based_on: string | null;
}): StoredLayout {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    items: row.items === null ? null : cleanItems(row.items),
    isDefault: row.is_default,
    basedOn: row.based_on,
  };
}

/** The person's tabs in the active space, the main one first. */
export function useDashboardLayouts() {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: dashboardLayoutKeys.layouts(user.id, space),
    queryFn: async (): Promise<StoredLayout[]> => {
      const { data, error } = await createClient()
        .from("dashboard_layouts")
        .select(LAYOUT_COLUMNS)
        .eq("user_id", user.id)
        .eq("space_id", space)
        .order("is_default", { ascending: false })
        .order("position")
        .limit(MAX_LAYOUTS);
      if (error) throw error;
      return data.map(toLayout);
    },
  });
}

function isSource(value: unknown): value is DefaultSource {
  return value === "space" || value === "group" || value === "worker";
}

/** What the owner set for this person here, and the widgets they may use. */
export function useDashboardContext() {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: dashboardLayoutKeys.context(user.id, space),
    queryFn: async (): Promise<DashboardContext> => {
      const { data, error } = await createClient().rpc("dashboard_context", { _space: space });
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      const source = isSource(raw.source) ? raw.source : null;
      return {
        source,
        groupName: typeof raw.group_name === "string" ? raw.group_name : null,
        items: source ? cleanItems(raw.items) : null,
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
        allowed: Array.isArray(raw.allowed)
          ? raw.allowed.filter((key): key is string => typeof key === "string")
          : null,
      };
    },
  });
}

/** Items as stored: positions of the full grid filled in. */
function toJson(items: readonly LayoutItem[]): Json {
  return withPositions(items) as unknown as Json;
}

type LayoutPatch =
  | { kind: "main"; layoutId: string | null; items: LayoutItem[]; basedOn: string | null }
  | { kind: "tab"; layoutId: string; items: LayoutItem[] };

/** Saves the items of a tab; the main tab gets its row the first time it is changed. */
export function useSaveLayoutItems() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  const key = dashboardLayoutKeys.layouts(user.id, space);
  return useMutation({
    mutationFn: async (patch: LayoutPatch) => {
      const supabase = createClient();
      if (patch.kind === "main" && !patch.layoutId) {
        const { data, error } = await supabase
          .from("dashboard_layouts")
          .insert({
            space_id: space,
            is_default: true,
            position: 0,
            items: toJson(patch.items),
            based_on: patch.basedOn,
          })
          .select(LAYOUT_COLUMNS)
          .single();
        if (error) throw error;
        return toLayout(data);
      }
      const { data, error } = await supabase
        .from("dashboard_layouts")
        .update({ items: toJson(patch.items) })
        .eq("id", patch.layoutId as string)
        .eq("user_id", user.id)
        .select(LAYOUT_COLUMNS)
        .single();
      if (error) throw error;
      return toLayout(data);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<StoredLayout[]>(key, (previous) => {
        const list = previous ?? [];
        return list.some((layout) => layout.id === saved.id)
          ? list.map((layout) => (layout.id === saved.id ? saved : layout))
          : [saved, ...list];
      });
    },
  });
}

/** The main tab follows the default again ("Reset" / "Back to the company's"). */
export function useResetMainLayout() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (layoutId: string) => {
      const { error } = await createClient()
        .from("dashboard_layouts")
        .update({ items: null, based_on: null })
        .eq("id", layoutId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.layouts(user.id, space) }),
  });
}

/** "Keep mine": the newer company default is no longer offered. */
export function useKeepOwnLayout() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ layoutId, basedOn }: { layoutId: string; basedOn: string }) => {
      const { error } = await createClient()
        .from("dashboard_layouts")
        .update({ based_on: basedOn })
        .eq("id", layoutId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.layouts(user.id, space) }),
  });
}

/** A new tab with a name and a starting layout, at the first free place. */
export function useCreateLayout() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      items,
      taken,
    }: {
      name: string;
      items: LayoutItem[];
      taken: number[];
    }) => {
      const position = [1, 2, 3, 4, 5].find((slot) => !taken.includes(slot));
      if (position === undefined) throw new Error("dashboard_layout_limit");
      const { data, error } = await createClient()
        .from("dashboard_layouts")
        .insert({ space_id: space, name, position, items: toJson(items) })
        .select(LAYOUT_COLUMNS)
        .single();
      if (error) throw error;
      return toLayout(data);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.layouts(user.id, space) }),
  });
}

export function useRenameLayout() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ layoutId, name }: { layoutId: string; name: string }) => {
      const { error } = await createClient()
        .from("dashboard_layouts")
        .update({ name })
        .eq("id", layoutId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.layouts(user.id, space) }),
  });
}

export function useDeleteLayout() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (layoutId: string) => {
      const { error } = await createClient()
        .from("dashboard_layouts")
        .delete()
        .eq("id", layoutId)
        .eq("user_id", user.id)
        .eq("is_default", false);
      if (error) throw error;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.layouts(user.id, space) }),
  });
}

// ---------------------------------------------------------------------------
// The owner's defaults (Company → Dashboards) and a worker's widget list
// ---------------------------------------------------------------------------

export type DefaultTarget =
  { kind: "space" } | { kind: "group"; groupId: string } | { kind: "worker"; workerId: string };

export type StoredDefault = {
  id: string;
  target: DefaultSource;
  groupId: string | null;
  workerId: string | null;
  items: LayoutItem[];
  updatedAt: string;
};

/** Every default of the owner's company (a handful: the company, groups, people). */
export function useDashboardDefaults(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: dashboardLayoutKeys.defaults(user.id),
    enabled,
    queryFn: async (): Promise<StoredDefault[]> => {
      const { data, error } = await createClient()
        .from("dashboard_defaults")
        .select("id, target, group_id, worker_id, items, updated_at")
        .eq("space_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data.flatMap((row) =>
        isSource(row.target)
          ? [
              {
                id: row.id,
                target: row.target,
                groupId: row.group_id,
                workerId: row.worker_id,
                items: cleanItems(row.items),
                updatedAt: row.updated_at,
              },
            ]
          : [],
      );
    },
  });
}

export function targetMatches(stored: StoredDefault, target: DefaultTarget): boolean {
  if (stored.target !== target.kind) return false;
  if (target.kind === "group") return stored.groupId === target.groupId;
  if (target.kind === "worker") return stored.workerId === target.workerId;
  return true;
}

/** Saves the owner's default for a target (a new row the first time). */
export function useSaveDashboardDefault() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = dashboardLayoutKeys.defaults(user.id);
  return useMutation({
    mutationFn: async ({
      target,
      existingId,
      items,
    }: {
      target: DefaultTarget;
      existingId: string | null;
      items: LayoutItem[];
    }) => {
      const supabase = createClient();
      const columns = "id, target, group_id, worker_id, items, updated_at" as const;
      const result = existingId
        ? await supabase
            .from("dashboard_defaults")
            .update({ items: toJson(items) })
            .eq("id", existingId)
            .eq("space_id", user.id)
            .select(columns)
            .single()
        : await supabase
            .from("dashboard_defaults")
            .insert({
              space_id: user.id,
              target: target.kind,
              group_id: target.kind === "group" ? target.groupId : null,
              worker_id: target.kind === "worker" ? target.workerId : null,
              items: toJson(items),
            })
            .select(columns)
            .single();
      if (result.error) throw result.error;
      return result.data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Removes a default: the people it was for get the next one (group, company, system). */
export function useDeleteDashboardDefault() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient()
        .from("dashboard_defaults")
        .delete()
        .eq("id", id)
        .eq("space_id", user.id);
      if (error) throw error;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.defaults(user.id) }),
  });
}

/** The widgets the owner lets this worker use; null = all they have data for. */
export function useWorkerWidgetList(workerId: string, enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: dashboardLayoutKeys.allowed(user.id, workerId),
    enabled,
    queryFn: async (): Promise<string[] | null> => {
      const { data, error } = await createClient()
        .from("worker_dashboard_widgets")
        .select("widgets")
        .eq("worker_id", workerId)
        .maybeSingle();
      if (error) throw error;
      return data ? data.widgets : null;
    },
  });
}

/** The owner sets the list (null = no limit, the row goes). */
export function useSaveWorkerWidgetList(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = dashboardLayoutKeys.allowed(user.id, workerId);
  return useMutation({
    mutationFn: async (widgets: string[] | null) => {
      const supabase = createClient();
      const { error } = widgets
        ? await supabase
            .from("worker_dashboard_widgets")
            .upsert({ worker_id: workerId, owner_id: user.id, widgets })
        : await supabase
            .from("worker_dashboard_widgets")
            .delete()
            .eq("worker_id", workerId)
            .eq("owner_id", user.id);
      if (error) throw error;
      return widgets;
    },
    onMutate: async (widgets) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[] | null>(key);
      queryClient.setQueryData(key, widgets);
      return { previous };
    },
    onError: (_error, _widgets, context) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/features/account/workspace-queries";
import { toSpaces } from "@/features/account/spaces";
import { createClient } from "@/lib/supabase/client";
import type { McpLevel } from "./levels";
import {
  disconnectApp,
  restoreFromTrash,
  setCompanyMcp,
  setConnectedAppLevel,
  type McpActionResult,
} from "./server/settings-actions";

export type ConnectedApp = {
  id: string;
  clientName: string;
  redirectHost: string | null;
  level: McpLevel;
  spaceId: string;
  spaceIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type ConnectedAppCall = {
  id: string;
  tool: string;
  level: "read" | "write" | "delete";
  ok: boolean;
  error: string | null;
  summary: string | null;
  createdAt: string;
};

export type TrashRow = {
  id: string;
  kind: string;
  title: string | null;
  via: string;
  deletedAt: string;
};

export const mcpKeys = {
  apps: (userId: string) => ["account", userId, "mcp-apps"] as const,
  calls: (userId: string, grantId: string) => ["account", userId, "mcp-calls", grantId] as const,
  counts: (userId: string) => ["account", userId, "mcp-counts"] as const,
  trash: (userId: string) => ["account", userId, "trash"] as const,
  spaces: (userId: string) => ["account", userId, "mcp-spaces"] as const,
  company: (userId: string) => ["workers", userId, "mcp"] as const,
};

export class McpActionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function ensure(result: McpActionResult) {
  if (!result.ok) throw new McpActionError(result.error);
}

export function useConnectedApps() {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: mcpKeys.apps(userId),
    queryFn: async (): Promise<ConnectedApp[]> => {
      const { data, error } = await createClient()
        .from("mcp_grants")
        .select(
          "id, client_name, redirect_host, level, space_id, space_ids, created_at, last_used_at",
        )
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        clientName: row.client_name,
        redirectHost: row.redirect_host,
        level: row.level as McpLevel,
        spaceId: row.space_id,
        spaceIds: row.space_ids,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }));
    },
  });
}

/** How many actions each connection made (calls of writing and deleting tools). */
export function useConnectedAppCounts(grantIds: string[]) {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: [...mcpKeys.counts(userId), grantIds.join(",")],
    enabled: grantIds.length > 0,
    queryFn: async () => {
      const counts = new Map<string, number>();
      await Promise.all(
        grantIds.map(async (id) => {
          const { count, error } = await createClient()
            .from("mcp_calls")
            .select("id", { count: "exact", head: true })
            .eq("grant_id", id)
            .eq("ok", true)
            .neq("level", "read");
          if (error) throw error;
          counts.set(id, count ?? 0);
        }),
      );
      return counts;
    },
  });
}

export function useConnectedAppCalls(grantId: string | null) {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: mcpKeys.calls(userId, grantId ?? ""),
    enabled: Boolean(grantId),
    queryFn: async (): Promise<ConnectedAppCall[]> => {
      const { data, error } = await createClient()
        .from("mcp_calls")
        .select("id, tool, level, ok, error, summary, created_at")
        .eq("grant_id", grantId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        tool: row.tool,
        level: row.level as ConnectedAppCall["level"],
        ok: row.ok,
        error: row.error,
        summary: row.summary,
        createdAt: row.created_at,
      }));
    },
  });
}

/** The names of the account's companies, for the list. */
export function useMySpaceNames() {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: mcpKeys.spaces(userId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_spaces");
      if (error) throw error;
      return toSpaces(data);
    },
  });
}

export function useTrash() {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: mcpKeys.trash(userId),
    queryFn: async (): Promise<TrashRow[]> => {
      const { data, error } = await createClient()
        .from("trash_items")
        .select("id, kind, title, via, deleted_at")
        .eq("user_id", userId)
        .is("restored_at", null)
        .order("deleted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        via: row.via,
        deletedAt: row.deleted_at,
      }));
    },
  });
}

export function useTrashRetention() {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: [...mcpKeys.trash(userId), "days"],
    queryFn: async () => {
      const { data } = await createClient().rpc("trash_retention_days");
      return typeof data === "number" ? data : 7;
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function useSetAppLevel() {
  const { userId } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, level }: { id: string; level: McpLevel }) =>
      ensure(await setConnectedAppLevel(id, level)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mcpKeys.apps(userId) }),
  });
}

export function useDisconnectApp() {
  const { userId } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => ensure(await disconnectApp(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mcpKeys.apps(userId) }),
  });
}

export function useRestoreFromTrash() {
  const { userId } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => ensure(await restoreFromTrash(id)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.trash(userId) });
      for (const root of [
        "pipeline",
        "contacts",
        "crmTasks",
        "calendar",
        "finance",
        "milestones",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [root] });
      }
    },
  });
}

/** The owner's company: the switch and which people have a client connected. */
export function useCompanyMcp(enabled: boolean) {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: mcpKeys.company(userId),
    enabled,
    queryFn: async () => {
      const db = createClient();
      const [setting, clients] = await Promise.all([
        db.from("mcp_space_settings").select("enabled").eq("space_id", userId).maybeSingle(),
        db.rpc("company_mcp_clients"),
      ]);
      if (setting.error) throw setting.error;
      if (clients.error) throw clients.error;
      return {
        enabled: setting.data?.enabled ?? true,
        clients: (clients.data ?? []).map((row) => ({
          workerId: row.worker_id,
          clients: row.clients,
          lastUsedAt: row.last_used_at,
        })),
      };
    },
  });
}

export function useSetCompanyMcp() {
  const { userId } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => ensure(await setCompanyMcp(enabled)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mcpKeys.company(userId) }),
  });
}

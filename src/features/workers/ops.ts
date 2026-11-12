import type { OpsEnv } from "@/lib/ops";
import {
  grantCounts,
  grantRows,
  legacyAccess,
  LEGACY_SOURCES,
  type LegacySection,
  type PermissionGrants,
} from "./permissions-catalog";
import { membershipDiff, type GroupTone } from "./company/tree";

/**
 * The owner's writes of Company, shared by the screens and Grady's tools
 * (only ever offered to the owner). RLS lets only the owner write; the
 * hierarchy guard refuses a cycle; read-only mode keeps the structure.
 */

export type MoveVia = "list" | "map" | "menu";

/** Puts a worker under another manager (null = right under the owner); the branch goes along. */
export async function moveWorker(
  env: OpsEnv,
  args: {
    ownerId: string;
    workerId: string;
    managerId: string | null;
    via: MoveVia;
    depth: number;
  },
): Promise<void> {
  const { error } = await env.db
    .from("workers")
    .update({ manager_id: args.managerId })
    .eq("id", args.workerId)
    .eq("owner_id", args.ownerId);
  if (error) throw error;
  env.track("worker_moved", {
    via: args.via,
    depth: Math.min(args.depth, 100),
    to_owner: args.managerId === null,
  });
}

export type GroupInput = {
  name: string;
  color: GroupTone;
  description: string | null;
  memberIds: string[];
};

/** A new group or changes to one, with its members added and removed. Returns its id. */
export async function saveGroup(
  env: OpsEnv,
  args: {
    ownerId: string;
    group: GroupInput;
    existing: { id: string; memberIds: string[] } | null;
    position: number;
  },
): Promise<string> {
  const { name, color, description, memberIds } = args.group;
  let groupId = args.existing?.id;
  if (groupId) {
    const { error } = await env.db
      .from("worker_groups")
      .update({ name, color, description })
      .eq("id", groupId)
      .eq("owner_id", args.ownerId);
    if (error) throw error;
  } else {
    const { data, error } = await env.db
      .from("worker_groups")
      .insert({ owner_id: args.ownerId, name, color, description, position: args.position })
      .select("id")
      .single();
    if (error) throw error;
    groupId = data.id;
  }
  const { added, removed } = membershipDiff(args.existing?.memberIds ?? [], memberIds);
  if (added.length > 0) {
    const { error } = await env.db
      .from("worker_group_members")
      .insert(
        added.map((workerId) => ({
          group_id: groupId!,
          worker_id: workerId,
          owner_id: args.ownerId,
        })),
      );
    if (error) throw error;
  }
  if (removed.length > 0) {
    const { error } = await env.db
      .from("worker_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("owner_id", args.ownerId)
      .in("worker_id", removed);
    if (error) throw error;
  }
  if (args.existing) {
    env.track("worker_group_updated", { added: added.length, removed: removed.length });
  } else {
    env.track("worker_group_created", { members: added.length });
  }
  return groupId;
}

/** Every right of the catalog as a row, so nothing is left to a default. */
export async function saveWorkerGrants(
  env: OpsEnv,
  args: { ownerId: string; workerId: string; grants: PermissionGrants },
): Promise<void> {
  const { error } = await env.db.from("worker_permission_grants").upsert(
    grantRows(args.grants).map((row) => ({
      ...row,
      owner_id: args.ownerId,
      worker_id: args.workerId,
    })),
    { onConflict: "worker_id,section,action" },
  );
  if (error) throw error;
  // How many sections a worker may see and how many they may change, never which person.
  const sections = Object.keys(LEGACY_SOURCES) as LegacySection[];
  const access = sections.map((section) => legacyAccess(args.grants, section));
  env.track("worker_permissions_saved", {
    view_sections: Math.min(grantCounts(args.grants).sections, 20),
    edit_sections: access.filter((level) => level.edit).length,
  });
}

/**
 * Removes the person from the company: access ends at once, the data stays.
 * Open deals and tasks go to `assignee` (an account) when given.
 */
export async function removeWorker(
  env: OpsEnv,
  args: { workerId: string; assignee: string | null; to: "owner" | "worker" | "nobody" },
): Promise<{ deals: number; tasks: number }> {
  const { data, error } = await env.db.rpc("company_remove_worker", {
    _worker_id: args.workerId,
    ...(args.assignee ? { _assignee: args.assignee } : {}),
  });
  if (error) throw error;
  const row = data[0];
  const counts = {
    deals: row?.deals ?? 0,
    tasks: (row?.crm_tasks ?? 0) + (row?.worker_tasks ?? 0),
  };
  env.track("worker_removed", {
    deals: Math.min(counts.deals, 10_000),
    tasks: Math.min(counts.tasks, 10_000),
    to: args.to,
  });
  return counts;
}

import "server-only";
import { getTranslations } from "next-intl/server";
import { workspaceFor, type Workspace } from "@/features/account/workspace";
import { GRANT_ROWS_LIMIT, grantsFromRows } from "@/features/workers/permissions-catalog";
import { trackLater } from "@/lib/analytics/track";
import type { FormatSettings } from "@/lib/format";
import type { Db } from "@/lib/ops";
import type { ToolContext, Translate } from "../../tools/types";

/**
 * The active space as Grady's tools see it: the same Workspace the app
 * builds in the browser (role, the worker's rights, read-only), read here
 * with the user's own client so it is the database's answer.
 */
export async function loadToolWorkspace(
  db: Db,
  userId: string,
  spaceId: string,
): Promise<Workspace> {
  let worker: { id: string; ownerId: string } | null = null;
  let grants: ReturnType<typeof grantsFromRows> = {};
  if (spaceId !== userId) {
    const { data, error } = await db
      .from("workers")
      .select("id, owner_id")
      .eq("user_id", userId)
      .eq("owner_id", spaceId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    // Not (or no longer) a worker there: nothing of that space is offered.
    if (!data)
      return { ...workspaceFor(userId, null, undefined, true), id: spaceId, role: "worker" };
    worker = { id: data.id, ownerId: data.owner_id };
    const rows = await db
      .from("worker_permission_grants")
      .select("section, action, allowed")
      .eq("worker_id", data.id)
      .limit(GRANT_ROWS_LIMIT);
    if (rows.error) throw rows.error;
    grants = grantsFromRows(rows.data);
  }
  const { data: plan, error } = await db.rpc("current_plan", {
    _user_id: worker?.ownerId ?? userId,
  });
  if (error) throw error;
  // When the plan can not be read, nothing is written (the database would refuse anyway).
  const readOnly = plan?.[0]?.read_only ?? true;
  return workspaceFor(userId, worker, grants, readOnly);
}

export async function toolTranslator(locale: string): Promise<Translate> {
  const t = await getTranslations({ locale, namespace: "grady.tools" });
  return (key, values) => t(key as never, values as never);
}

export async function createToolContext(args: {
  db: Db;
  userId: string;
  spaceId: string;
  settings: FormatSettings;
  locale: string;
  country: string | null;
  workspace?: Workspace;
}): Promise<ToolContext> {
  const workspace = args.workspace ?? (await loadToolWorkspace(args.db, args.userId, args.spaceId));
  return {
    db: args.db,
    userId: args.userId,
    workspaceId: workspace.id,
    workspace,
    settings: args.settings,
    timezone: args.settings.timeZone,
    locale: args.locale,
    country: args.country,
    t: await toolTranslator(args.locale),
    track: (event, props) =>
      trackLater(event, props, {
        userId: args.userId,
        ...(workspace.id !== args.userId ? { ownerId: workspace.id } : {}),
      }),
  };
}

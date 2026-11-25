"use server";

import { cleanItems, MAX_LAYOUTS, withPositions, type LayoutItem } from "@/features/widgets/grid";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { adminAccess, adminAccessFor } from "../../server/guard";
import { fingerprint, requestInfo } from "../../server/request-info";
import {
  ADMIN_DEFAULT_SETTING,
  LAYOUT_COLUMNS,
  toStoredLayout,
  type AdminStoredLayout,
} from "./layouts";

/**
 * Saving the overview's tabs (29.2): the administrator's own rows only, with
 * the admin client after the admin guard (the table has no client access).
 * A layout is personal like a preference: no audit row; the default for new
 * administrators is a setting and goes through admin_set_app_setting
 * (owner or full admin, aal2, audited).
 */

export type LayoutResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: "forbidden" | "invalid" | "limit" | "failed" };

const NAME_MAX = 40;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

/** The items as stored: only well formed ones, positions of the full grid filled in. */
function toJson(items: unknown): Json | null {
  if (!Array.isArray(items)) return null;
  return withPositions(cleanItems(items)) as unknown as Json;
}

/** Saves a tab's widgets; the main tab (`layoutId` null) gets its row the first time. */
export async function saveAdminLayout(input: {
  layoutId: string | null;
  items: LayoutItem[];
}): Promise<LayoutResult<AdminStoredLayout>> {
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const items = toJson(input.items);
  if (!items) return { ok: false, error: "invalid" };
  const admin = createAdminClient();
  const result = input.layoutId
    ? await admin
        .from("admin_dashboard_layouts")
        .update({ items })
        .eq("id", input.layoutId)
        .eq("user_id", context.userId)
        .select(LAYOUT_COLUMNS)
        .maybeSingle()
    : await admin
        .from("admin_dashboard_layouts")
        .upsert(
          { user_id: context.userId, is_default: true, position: 0, items },
          { onConflict: "user_id,position" },
        )
        .select(LAYOUT_COLUMNS)
        .maybeSingle();
  if (result.error || !result.data) {
    if (result.error) console.error("[admin] saving the overview failed", result.error.message);
    return { ok: false, error: "failed" };
  }
  return { ok: true, value: toStoredLayout(result.data) };
}

/** A new tab at the first free place, with a name and its first widgets (empty or a ready set). */
export async function createAdminLayout(input: {
  name: string;
  items: LayoutItem[];
}): Promise<LayoutResult<AdminStoredLayout>> {
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const name = cleanName(input.name);
  const items = toJson(input.items);
  if (!name || !items) return { ok: false, error: "invalid" };
  const admin = createAdminClient();
  const { data: taken, error: readError } = await admin
    .from("admin_dashboard_layouts")
    .select("position")
    .eq("user_id", context.userId);
  if (readError) return { ok: false, error: "failed" };
  const used = new Set((taken ?? []).map((row) => row.position));
  const position = Array.from({ length: MAX_LAYOUTS - 1 }, (_, index) => index + 1).find(
    (slot) => !used.has(slot),
  );
  if (position === undefined) return { ok: false, error: "limit" };
  const { data, error } = await admin
    .from("admin_dashboard_layouts")
    .insert({ user_id: context.userId, name, position, items })
    .select(LAYOUT_COLUMNS)
    .single();
  if (error || !data) {
    if (error) console.error("[admin] a new overview tab failed", error.message);
    return { ok: false, error: error?.code === "23505" ? "limit" : "failed" };
  }
  return { ok: true, value: toStoredLayout(data) };
}

export async function renameAdminLayout(input: { layoutId: string; name: string }): Promise<LayoutResult> {
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const name = cleanName(input.name);
  if (!name || typeof input.layoutId !== "string") return { ok: false, error: "invalid" };
  const { error } = await createAdminClient()
    .from("admin_dashboard_layouts")
    .update({ name })
    .eq("id", input.layoutId)
    .eq("user_id", context.userId)
    .eq("is_default", false);
  return error ? { ok: false, error: "failed" } : { ok: true };
}

export async function deleteAdminLayout(layoutId: string): Promise<LayoutResult> {
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  if (typeof layoutId !== "string") return { ok: false, error: "invalid" };
  const { error } = await createAdminClient()
    .from("admin_dashboard_layouts")
    .delete()
    .eq("id", layoutId)
    .eq("user_id", context.userId)
    .eq("is_default", false);
  return error ? { ok: false, error: "failed" } : { ok: true };
}

/** The main tab follows the default again. */
export async function resetAdminMainLayout(): Promise<LayoutResult> {
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const { error } = await createAdminClient()
    .from("admin_dashboard_layouts")
    .update({ items: null })
    .eq("user_id", context.userId)
    .eq("is_default", true);
  return error ? { ok: false, error: "failed" } : { ok: true };
}

/**
 * "Set as the default for new administrators": the layout every
 * administrator's main tab follows until they change their own. The owner
 * or a full admin; the database checks it again and audits it.
 */
export async function setAdminDashboardDefault(items: LayoutItem[]): Promise<LayoutResult> {
  if (!(await adminAccessFor("setDashboardDefault"))) return { ok: false, error: "forbidden" };
  const value = toJson(items);
  if (!value || (value as unknown[]).length === 0) return { ok: false, error: "invalid" };
  const { ip } = await requestInfo();
  const { error } = await (await createClient()).rpc("admin_set_app_setting", {
    _key: ADMIN_DEFAULT_SETTING,
    _value: value,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    console.error("[admin] saving the default overview failed", error.message);
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}

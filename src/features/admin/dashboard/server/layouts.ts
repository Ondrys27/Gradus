import "server-only";
import { cleanItems, type LayoutItem } from "@/features/widgets/grid";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import type { AdminContext } from "../../server/guard";
import { visibleAdminItems } from "../catalog";
import { adminSystemDefault } from "../defaults";

/**
 * The overview's tabs of one administrator (29.2) in admin_dashboard_layouts,
 * read and written only here, with the admin client after the admin guard
 * and always for the session's own account. The main tab with no items
 * follows the default live: the owner's default for administrators
 * (app_settings 'admin_dashboard_default') or the system's.
 */

export const ADMIN_DEFAULT_SETTING = "admin_dashboard_default";

export type AdminStoredLayout = {
  id: string;
  /** Null for the main tab ("Overview" in the user's language). */
  name: string | null;
  position: number;
  /** Null: the main tab follows the default. */
  items: LayoutItem[] | null;
  isDefault: boolean;
};

export type AdminDashboardState = {
  layouts: AdminStoredLayout[];
  /** The default the main tab follows: the owner's for administrators, else the system's. */
  defaultItems: LayoutItem[];
  defaultFrom: "owner" | "system";
};

export const LAYOUT_COLUMNS = "id, name, position, items, is_default" as const;

export function toStoredLayout(row: {
  id: string;
  name: string | null;
  position: number;
  items: Json | null;
  is_default: boolean;
}): AdminStoredLayout {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    items: row.items === null ? null : cleanItems(row.items),
    isDefault: row.is_default,
  };
}

/** The default for administrators the owner saved, or null. */
export async function loadAdminDefault(): Promise<LayoutItem[] | null> {
  const { data, error } = await createAdminClient()
    .from("app_settings")
    .select("value")
    .eq("key", ADMIN_DEFAULT_SETTING)
    .maybeSingle();
  if (error) throw new Error(`admin dashboard default: ${error.message}`);
  if (!data) return null;
  const items = cleanItems(data.value);
  return items.length ? items : null;
}

/** Everything the overview needs to draw its tabs, for the signed-in administrator. */
export async function loadAdminDashboard(context: AdminContext): Promise<AdminDashboardState> {
  const [rows, owner] = await Promise.all([
    createAdminClient()
      .from("admin_dashboard_layouts")
      .select(LAYOUT_COLUMNS)
      .eq("user_id", context.userId)
      .order("is_default", { ascending: false })
      .order("position")
      .limit(6),
    loadAdminDefault(),
  ]);
  if (rows.error) throw new Error(`admin_dashboard_layouts: ${rows.error.message}`);
  const actor = { role: context.role, level: context.level };
  return {
    layouts: rows.data.map(toStoredLayout),
    // A limited admin never gets the Money widgets, not even from the owner's default.
    defaultItems: visibleAdminItems(owner ?? adminSystemDefault(), actor),
    defaultFrom: owner ? "owner" : "system",
  };
}

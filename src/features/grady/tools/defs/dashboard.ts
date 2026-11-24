import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { can, type Workspace } from "@/features/account/workspace";
import type { WidgetAccess } from "@/features/dashboard/widgets/access";
import { widgetAllowed } from "@/features/dashboard/widgets/access";
import { WIDGET_KEYS, widgetMeta } from "@/features/dashboard/widgets/catalog";
import { systemDefault } from "@/features/dashboard/widgets/defaults";
import {
  addItem,
  cleanItems,
  newItemId,
  removeItem,
  WIDGET_SIZES,
  withPositions,
  type LayoutItem,
} from "@/features/dashboard/widgets/grid";
import { resolveMain } from "@/features/dashboard/widgets/resolve";
import { industryKeyOf } from "@/features/onboarding/industries";
import type { GrantAction, GrantSection } from "@/features/workers/permissions-catalog";
import type { Json } from "@/types/database";
import { defineTool, ToolError, type ToolContext } from "../types";
import { inserted, updated, uuid } from "./shared";

/**
 * The person's own dashboard (28.5): put a widget on it or take one off,
 * exactly as the board's editor does. A dashboard is personal (writable in a
 * read-only space too, like the settings); only widgets the account may use
 * here are placed (the same rules as the gallery), and the board hides any
 * the account loses later. The main tab that still follows the default gets
 * its own copy on the first change, as in the editor, and Undo returns it to
 * following the default.
 */

type LayoutRow = { id: string; is_default: boolean; items: Json | null; based_on: string | null };

async function layoutRows(ctx: ToolContext): Promise<LayoutRow[]> {
  const { data, error } = await ctx.db
    .from("dashboard_layouts")
    .select("id, is_default, items, based_on")
    .eq("user_id", ctx.userId)
    .eq("space_id", ctx.workspaceId)
    .limit(10);
  if (error) throw error;
  return data;
}

/** What the owner set for this person and the widgets they may use (dashboard_context). */
async function companyContext(ctx: ToolContext) {
  const { data, error } = await ctx.db.rpc("dashboard_context", { _space: ctx.workspaceId });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    items: raw.source && raw.items ? cleanItems(raw.items) : null,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
    allowed: Array.isArray(raw.allowed)
      ? raw.allowed.filter((key): key is string => typeof key === "string")
      : null,
  };
}

async function profileOf(ctx: ToolContext) {
  const { data, error } = await ctx.db
    .from("profiles")
    .select("mode, industry")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The gallery's rules on the server; every section counts as open (the board hides locked ones). */
export function widgetAccessFor(
  workspace: Workspace,
  playing: boolean,
  allowList: readonly string[] | null,
): WidgetAccess {
  return {
    role: workspace.role,
    can: (section, action) => can(workspace, section as GrantSection, action as GrantAction),
    navOpen: new Set([
      "dashboard",
      "milestones",
      "notes",
      "contacts",
      "coldCalling",
      "pipeline",
      "tasks",
      "calendar",
      "scheduler",
      "finance",
      "invoices",
      "messages",
      "workers",
    ]),
    playing,
    allowList,
  };
}

/** The tab to change and the items it shows now. */
async function boardOf(ctx: ToolContext, dashboardId: string | undefined) {
  const [rows, company, profile] = await Promise.all([
    layoutRows(ctx),
    companyContext(ctx),
    profileOf(ctx),
  ]);
  const playing = ctx.workspace.role === "owner" && profile?.mode !== "tool";
  const access = widgetAccessFor(ctx.workspace, playing, company.allowed);
  if (dashboardId) {
    const row = rows.find((item) => item.id === dashboardId && !item.is_default);
    if (!row) throw new ToolError("notFound");
    return { row, items: cleanItems(row.items), access, basedOn: null };
  }
  const main = rows.find((item) => item.is_default) ?? null;
  const resolution = resolveMain({
    own: main
      ? { items: main.items === null ? null : cleanItems(main.items), basedOn: main.based_on }
      : null,
    company: company.items ? { items: company.items, updatedAt: company.updatedAt } : null,
    system: systemDefault({
      role: ctx.workspace.role,
      playing,
      industry: industryKeyOf(profile?.industry ?? null),
    }),
  });
  return { row: main, items: resolution.items, access, basedOn: company.updatedAt };
}

async function save(
  ctx: ToolContext,
  board: Awaited<ReturnType<typeof boardOf>>,
  items: LayoutItem[],
) {
  const json = withPositions(items) as unknown as Json;
  if (!board.row) {
    const { data, error } = await ctx.db
      .from("dashboard_layouts")
      .insert({
        space_id: ctx.workspaceId,
        is_default: true,
        position: 0,
        items: json,
        based_on: board.basedOn,
      })
      .select("id")
      .single();
    if (error) throw error;
    return inserted("dashboard_layouts", data.id);
  }
  const { error } = await ctx.db
    .from("dashboard_layouts")
    .update({ items: json })
    .eq("id", board.row.id)
    .eq("user_id", ctx.userId);
  if (error) throw error;
  return updated("dashboard_layouts", board.row.id, { items: board.row.items });
}

const widget = z.enum(WIDGET_KEYS as unknown as [string, ...string[]]);

/** The widget's name as the gallery shows it, in the user's language. */
async function widgetName(ctx: ToolContext, key: string): Promise<string> {
  const t = await getTranslations({ locale: ctx.locale, namespace: "dashboard.widgets" });
  return t(`${key}.name` as never);
}

export const dashboardTools = [
  defineTool({
    name: "place_widget",
    section: "dashboard",
    action: null,
    kind: "write",
    risk: "instant",
    description:
      "Put a widget on the user's dashboard (the main one, or a tab by dashboardId) at the first free place, in a size it has (S, M, L, XL; default its usual one). Only widgets the user may use here.",
    input: z.object({
      widget,
      size: z.enum(WIDGET_SIZES).optional(),
      dashboardId: uuid.optional(),
    }),
    describe: (input, t) => t("place_widget", { widget: input.widget }),
    async execute(ctx, input) {
      const meta = widgetMeta(input.widget);
      if (!meta) throw new ToolError("notFound");
      const board = await boardOf(ctx, input.dashboardId);
      if (!widgetAllowed(input.widget, board.access)) {
        throw new ToolError("forbidden", "The user may not use this widget here.");
      }
      if (board.items.some((item) => item.widget === input.widget)) {
        throw new ToolError("alreadyOnDashboard");
      }
      const size =
        input.size && (meta.sizes as readonly string[]).includes(input.size)
          ? input.size
          : meta.defaultSize;
      const next = addItem(board.items, {
        id: newItemId(),
        widget: input.widget,
        size,
        x: 0,
        y: 0,
        settings: {},
      });
      if (next.length === board.items.length) throw new ToolError("dashboardFull");
      const record = await save(ctx, board, next);
      ctx.track("dashboard_widget_added", {
        widget: input.widget as never,
        size,
        count: next.length,
      });
      return {
        output: { placed: input.widget, size },
        records: [record],
        summary: ctx.t("place_widget", { widget: await widgetName(ctx, input.widget) }),
        href: input.dashboardId ? `/app?board=${input.dashboardId}` : "/app",
      };
    },
    undoable: true,
    invalidates: ["dashboard-layouts"],
  }),

  defineTool({
    name: "hide_widget",
    section: "dashboard",
    action: null,
    kind: "write",
    risk: "instant",
    description:
      "Take a widget off the user's dashboard (the main one, or a tab by dashboardId); the others close the gap.",
    input: z.object({ widget, dashboardId: uuid.optional() }),
    describe: (input, t) => t("hide_widget", { widget: input.widget }),
    async execute(ctx, input) {
      const board = await boardOf(ctx, input.dashboardId);
      const item = board.items.find((entry) => entry.widget === input.widget);
      if (!item) throw new ToolError("notOnDashboard");
      const record = await save(ctx, board, removeItem(board.items, item.id));
      ctx.track("dashboard_widget_removed", { widget: input.widget as never });
      return {
        output: { removed: input.widget },
        records: [record],
        summary: ctx.t("hide_widget", { widget: await widgetName(ctx, input.widget) }),
        href: input.dashboardId ? `/app?board=${input.dashboardId}` : "/app",
      };
    },
    undoable: true,
    invalidates: ["dashboard-layouts"],
  }),
];

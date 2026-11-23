import { describe, expect, it } from "vitest";
import { can, workspaceFor } from "@/features/account/workspace";
import { navItemsFor } from "@/components/layout/nav-items";
import type { GrantSection, PermissionGrants } from "@/features/workers/permissions-catalog";
import {
  allowedOptions,
  allowedQuickActions,
  availableWidgets,
  effectiveChoice,
  effectiveSettings,
  grantableWidgets,
  visibleItems,
  widgetAllowed,
  type WidgetAccess,
} from "./access";
import { WIDGETS, widgetMeta, type ChoiceSetting } from "./catalog";
import { systemDefault } from "./defaults";
import { TEMPLATE_ACCESS, workerWidgetAccess } from "./worker-access";
import { arrange, hasCollision } from "./grid";

const OWNER = "00000000-0000-0000-0000-000000000001";
const ACCOUNT = "00000000-0000-0000-0000-000000000002";

/** The same inputs the app builds in useWidgetAccess, for an owner or a worker with these grants. */
function accessOf(
  grants: PermissionGrants | null,
  options: { playing?: boolean; locked?: string[]; allowList?: string[] | null } = {},
): WidgetAccess {
  const workspace = workspaceFor(
    grants ? ACCOUNT : OWNER,
    grants ? { id: "w1", ownerId: OWNER } : null,
    grants ?? undefined,
  );
  const navAccess = grants
    ? {
        permissions: workspace.permissions,
        company: can(workspace, "company", "view"),
        scheduler: can(workspace, "scheduler", "own"),
      }
    : null;
  const navOpen = new Set(
    navItemsFor(navAccess)
      .map((item) => item.key as string)
      .filter((key) => !(options.locked ?? []).includes(key)),
  );
  return {
    role: grants ? "worker" : "owner",
    can: (section, action) => can(workspace, section as GrantSection, action as never),
    navOpen,
    playing: options.playing ?? false,
    allowList: options.allowList ?? null,
  };
}

const keys = (access: WidgetAccess) => availableWidgets(access).map((meta) => meta.key);
const FINANCE_WIDGETS = ["financeMonth", "capital", "overdueInvoices"];

describe("widgets of the owner", () => {
  it("has every widget of the owner's role in tool mode, the level only when playing", () => {
    const tool = keys(accessOf(null));
    expect(tool).toEqual(expect.arrayContaining([...FINANCE_WIDGETS, "team", "pipeline", "today"]));
    expect(tool).not.toContain("level");
    expect(tool).not.toContain("workTimer");
    expect(keys(accessOf(null, { playing: true }))).toContain("level");
  });

  it("drops the widgets of a section locked in game mode", () => {
    const locked = keys(accessOf(null, { playing: true, locked: ["finance", "pipeline"] }));
    for (const key of [...FINANCE_WIDGETS, "pipeline", "onFire", "winRate"]) {
      expect(locked).not.toContain(key);
    }
    expect(locked).toContain("today");
  });
});

describe("widgets of a worker", () => {
  const sales: PermissionGrants = {
    pipeline: ["view", "create"],
    contacts: ["view"],
    calendar: ["view"],
  };

  it("never offers finance widgets without the finance right", () => {
    const access = accessOf(sales);
    for (const key of FINANCE_WIDGETS) expect(widgetAllowed(key, access)).toBe(false);
    expect(keys(access)).toEqual(
      expect.arrayContaining(["pipeline", "onFire", "meetings", "workTimer"]),
    );
  });

  it("finance view alone is not enough for the month's money: it needs summaries", () => {
    expect(widgetAllowed("financeMonth", accessOf({ finance: ["view"] }))).toBe(false);
    expect(widgetAllowed("financeMonth", accessOf({ finance: ["view", "summaries"] }))).toBe(true);
    expect(widgetAllowed("overdueInvoices", accessOf({ invoices: ["view"] }))).toBe(true);
  });

  it("follows the owner's list of widgets", () => {
    const access = accessOf(sales, { allowList: ["today", "pipeline", "financeMonth"] });
    expect(keys(access)).toEqual(["today", "pipeline"]);
    expect(grantableWidgets(access).map((meta) => meta.key)).toContain("onFire");
  });

  it("leaves forbidden items out of a layout quietly", () => {
    const items = systemDefault({ role: "owner", playing: false, industry: "other" });
    const visible = visibleItems(items, accessOf(sales));
    expect(visible.map((item) => item.widget)).not.toEqual(
      expect.arrayContaining(["financeMonth"]),
    );
    expect(hasCollision(arrange(visible, 4), 4)).toBe(false);
  });

  it("drops an item stored in a size the widget does not have", () => {
    const access = accessOf(null);
    expect(
      visibleItems([{ id: "a", widget: "level", size: "XL", x: 0, y: 0, settings: {} }], access),
    ).toEqual([]);
  });

  it("offers everyone's tasks only with tasks: all", () => {
    const setting = widgetMeta("overdueTasks")!.settings[0] as ChoiceSetting;
    expect(allowedOptions(setting, accessOf({ pipeline: ["view"] }))).toEqual(["mine"]);
    expect(effectiveChoice(setting, "all", accessOf({ pipeline: ["view"] }))).toBe("mine");
    expect(allowedOptions(setting, accessOf(null))).toEqual(["mine", "all"]);
  });

  it("shows amounts in the pipeline widget only with see amounts", () => {
    const setting = widgetMeta("pipeline")!.settings[0] as ChoiceSetting;
    expect(effectiveChoice(setting, "value", accessOf(sales))).toBe("count");
    expect(effectiveChoice(setting, "value", accessOf({ pipeline: ["view", "see_amounts"] }))).toBe(
      "value",
    );
  });

  it("settings a worker may not choose fall back to allowed ones", () => {
    const meta = widgetMeta("overdueTasks")!;
    expect(effectiveSettings(meta, { scope: "all" }, accessOf(sales))).toEqual({ scope: "mine" });
    expect(effectiveSettings(meta, { scope: "all" }, accessOf(null))).toEqual({ scope: "all" });
    expect(effectiveSettings(widgetMeta("meetings")!, { days: "99" }, accessOf(null))).toEqual({
      days: "7",
    });
  });

  it("quick actions follow the rights of each", () => {
    expect(allowedQuickActions(accessOf(sales))).toEqual(["newDeal", "newNote"]);
    expect(allowedQuickActions(accessOf(null))).toEqual(
      expect.arrayContaining(["newContact", "newMilestone", "newTask"]),
    );
  });
});

describe("the owner's side", () => {
  it("computes a worker's widgets from their rights like their own app does", () => {
    const grants: PermissionGrants = { pipeline: ["view"], calendar: ["view"] };
    expect(keys(workerWidgetAccess(grants))).toEqual(keys(accessOf(grants)));
    expect(keys(workerWidgetAccess({ finance: ["view", "summaries"] }))).toContain("financeMonth");
  });

  it("a company template may hold every widget a worker could have, never the owner's own", () => {
    const template = keys(TEMPLATE_ACCESS);
    expect(template).toEqual(
      expect.arrayContaining(["workTimer", "financeMonth", "team", "pipeline"]),
    );
    expect(template).not.toContain("level");
  });
});

describe("system defaults", () => {
  it("are valid layouts of widgets with their sizes", () => {
    for (const role of ["owner", "worker"] as const) {
      for (const playing of [true, false]) {
        for (const industry of ["coaching", "ecommerce", "other"] as const) {
          const items = systemDefault({ role, playing, industry });
          for (const item of items) {
            const meta = widgetMeta(item.widget);
            expect(meta, item.widget).toBeDefined();
            expect(meta!.sizes).toContain(item.size);
          }
          expect(hasCollision(arrange(items, 4), 4)).toBe(false);
        }
      }
    }
  });

  it("differ by mode and industry", () => {
    const widgets = (playing: boolean, industry: "coaching" | "ecommerce" | "other") =>
      systemDefault({ role: "owner", playing, industry }).map((item) => item.widget);
    expect(widgets(true, "other")).toContain("level");
    expect(widgets(false, "other")).not.toContain("level");
    expect(widgets(false, "coaching")).toContain("bookings");
    expect(widgets(false, "ecommerce")).not.toContain("coldCalling");
    expect(widgets(false, "ecommerce")).toContain("capital");
  });

  it("catalog sizes and default sizes agree", () => {
    for (const meta of WIDGETS) {
      expect(meta.sizes as readonly string[]).toContain(meta.defaultSize);
    }
  });
});

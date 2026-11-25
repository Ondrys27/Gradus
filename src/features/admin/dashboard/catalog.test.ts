import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { adminCan, type AdminActor } from "../roles";
import { ADMIN_WIDGET_APPEARANCE } from "./appearance";
import {
  ADMIN_WIDGET_CATEGORIES,
  ADMIN_WIDGET_KEYS,
  ADMIN_WIDGETS,
  adminWidgetAllowed,
  availableAdminWidgets,
  LIVE_WIDGETS,
  PERIOD_SETTING,
  visibleAdminItems,
} from "./catalog";
import { ADMIN_DEFAULT_ENTRIES, ADMIN_TEMPLATES, adminSystemDefault, adminTemplate } from "./defaults";
import { badgeText, titleWithCount } from "./error-badge";
import { widgetView, widgetViewQuery } from "./period";
import { parseAdminView } from "../view-state";

const OWNER: AdminActor = { role: "owner", level: "full" };
const FULL: AdminActor = { role: "admin", level: "full" };
const LIMITED: AdminActor = { role: "admin", level: "limited" };

type Messages = { admin: { widgets: Record<string, unknown> } };
const widgets = (messages: unknown) => (messages as Messages).admin.widgets;

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    messages,
  );
}

describe("the overview's widget catalog", () => {
  it("has every widget once, with its icon, a category and two to three sizes", () => {
    expect(new Set(ADMIN_WIDGET_KEYS).size).toBe(ADMIN_WIDGET_KEYS.length);
    for (const meta of ADMIN_WIDGETS) {
      expect(ADMIN_WIDGET_APPEARANCE[meta.key], meta.key).toBeDefined();
      expect(ADMIN_WIDGET_CATEGORIES).toContain(meta.category);
      expect(meta.sizes.length, meta.key).toBeGreaterThanOrEqual(2);
      expect(meta.sizes.length, meta.key).toBeLessThanOrEqual(3);
      expect(meta.sizes as readonly string[]).toContain(meta.defaultSize);
      expect(meta.href.startsWith("/admin"), meta.key).toBe(true);
    }
    expect(Object.keys(ADMIN_WIDGET_APPEARANCE).sort()).toEqual([...ADMIN_WIDGET_KEYS].sort());
  });

  it("has the name and description of every widget and category in both languages", () => {
    for (const messages of [cs, en]) {
      const items = widgets(messages).items as Record<string, { name?: string; description?: string }>;
      for (const key of ADMIN_WIDGET_KEYS) {
        expect(items[key]?.name, key).toBeTruthy();
        expect(items[key]?.description, key).toBeTruthy();
      }
      for (const category of ADMIN_WIDGET_CATEGORIES) {
        expect(lookup(messages, `admin.widgets.categories.${category}`), category).toBeTruthy();
      }
      for (const option of PERIOD_SETTING.options) {
        expect(lookup(messages, `admin.widgets.settings.period.${option}`), option).toBeTruthy();
      }
    }
  });

  it("has every label the widgets' data names, in both languages", () => {
    const source = readFileSync(path.join(__dirname, "server/widget-data.ts"), "utf8");
    const keys = new Set<string>();
    for (const match of source.matchAll(/(?:figure|W)\(\s*"([a-zA-Z]+)",\s*"([a-zA-Z]+)"/g)) {
      keys.add(`admin.widgets.${match[1]}.figures.${match[2]}`);
    }
    for (const match of source.matchAll(/"(admin\.widgets\.[a-zA-Z.]+)"/g)) keys.add(match[1]!);
    expect(keys.size).toBeGreaterThan(40);
    for (const messages of [cs, en]) {
      for (const key of keys) expect(lookup(messages, key), key).toBeTypeOf("string");
    }
  });

  it("refreshes errors, health, new users and revenue every minute", () => {
    expect([...LIVE_WIDGETS].sort()).toEqual(["errors", "health", "newUsers", "revenue"]);
  });
});

describe("who has which widget", () => {
  const money = ADMIN_WIDGETS.filter((meta) => meta.category === "money").map((meta) => meta.key);

  it("gives a limited admin no Money widget at all", () => {
    expect(money.length).toBeGreaterThanOrEqual(6);
    const keys = availableAdminWidgets(LIMITED).map((meta) => meta.key);
    for (const key of money) {
      expect(keys).not.toContain(key);
      expect(adminWidgetAllowed(key, LIMITED)).toBe(false);
    }
    expect(adminCan(LIMITED, "viewMoney")).toBe(false);
    expect(keys).toEqual(expect.arrayContaining(["errors", "health", "newUsers", "aiSpend", "waiting"]));
  });

  it("gives the owner and a full admin every widget", () => {
    for (const actor of [OWNER, FULL]) {
      expect(availableAdminWidgets(actor).map((meta) => meta.key)).toEqual(ADMIN_WIDGET_KEYS);
    }
  });

  it("leaves a widget out of a layout quietly when it is not the admin's, or in a size it lacks", () => {
    const items = [
      { id: "1", widget: "errors", size: "L" as const },
      { id: "2", widget: "revenue", size: "L" as const },
      { id: "3", widget: "health", size: "XL" as const },
      { id: "4", widget: "unknown", size: "M" as const },
    ];
    expect(visibleAdminItems(items, LIMITED).map((item) => item.id)).toEqual(["1"]);
    expect(visibleAdminItems(items, OWNER).map((item) => item.id)).toEqual(["1", "2"]);
    expect(adminWidgetAllowed("errors", null)).toBe(false);
  });

  it("lets only the owner and a full admin set the default for new administrators", () => {
    expect(adminCan(OWNER, "setDashboardDefault")).toBe(true);
    expect(adminCan(FULL, "setDashboardDefault")).toBe(true);
    expect(adminCan(LIMITED, "setDashboardDefault")).toBe(false);
  });
});

describe("the default overview and the ready tabs", () => {
  it("is the overview of step 29.2, in widgets and sizes the catalog has", () => {
    expect(ADMIN_DEFAULT_ENTRIES).toEqual([
      ["errors", "L"],
      ["health", "M"],
      ["newUsers", "M"],
      ["activeUsers", "M"],
      ["revenue", "L"],
      ["aiSpend", "M"],
      ["margin", "M"],
      ["reports", "M"],
      ["waiting", "M"],
      ["trialsEnding", "S"],
      ["failedPayments", "S"],
    ]);
    const layout = adminSystemDefault();
    expect(visibleAdminItems(layout, OWNER)).toHaveLength(layout.length);
    expect(new Set(layout.map((item) => item.id)).size).toBe(layout.length);
  });

  it("drops the Money widgets for a limited admin", () => {
    const shown = visibleAdminItems(adminSystemDefault(), LIMITED).map((item) => item.widget);
    expect(shown).not.toContain("revenue");
    expect(shown).not.toContain("margin");
    expect(shown).not.toContain("failedPayments");
    expect(shown).toContain("errors");
  });

  it("has ready tabs for Operations, Money, AI and People, each fitting the catalog", () => {
    expect([...ADMIN_TEMPLATES]).toEqual(["operations", "money", "ai", "people"]);
    for (const template of ADMIN_TEMPLATES) {
      const items = adminTemplate(template);
      expect(items.length, template).toBeGreaterThan(3);
      expect(visibleAdminItems(items, OWNER), template).toHaveLength(items.length);
    }
    expect(adminTemplate("money").every((item) => !adminWidgetAllowed(item.widget, LIMITED))).toBe(false);
  });
});

describe("a widget's own period", () => {
  const bar = parseAdminView(new URLSearchParams("period=90d&plan=pro&cmp=0"));

  it("follows the bar unless the widget has one of its own", () => {
    expect(widgetView(bar, "bar")).toEqual(bar);
    expect(widgetView(bar, undefined)).toEqual(bar);
    expect(widgetView(bar, "nonsense")).toEqual(bar);
    expect(widgetView(bar, "today")).toEqual({ ...bar, period: "today", from: null, to: null });
  });

  it("keeps the bar's filters in the widget's query", () => {
    const query = new URLSearchParams(widgetViewQuery("?period=90d&plan=pro&cmp=0&board=x", "today"));
    expect(query.get("period")).toBe("today");
    expect(query.get("plan")).toBe("pro");
    expect(query.get("cmp")).toBe("0");
    expect(query.has("board")).toBe(false);
  });
});

describe("the error badge", () => {
  it("counts up to 99, then 99+", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(120)).toBe("99+");
  });

  it("puts the count in front of the tab's title and takes it away again", () => {
    expect(titleWithCount("Přehled · Gradus", 3)).toBe("(3) Přehled · Gradus");
    expect(titleWithCount("(3) Přehled · Gradus", 5)).toBe("(5) Přehled · Gradus");
    expect(titleWithCount("(99+) Přehled · Gradus", 0)).toBe("Přehled · Gradus");
  });
});

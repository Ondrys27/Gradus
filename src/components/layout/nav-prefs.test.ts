import { describe, expect, it } from "vitest";
import { navItems, navItemsFor, workerOnlyItems, bottomNavKeys } from "./nav-items";
import {
  bottomBarKeys,
  EMPTY_NAV_PREFS,
  flattenNavGroups,
  groupNavItems,
  isDefaultNavPrefs,
  MAX_PINNED,
  moveNavItem,
  NAV_DEFAULT_ORDER,
  NAV_GROUP_OF,
  navEditorGroups,
  parseNavPrefs,
  toggleHidden,
  togglePinned,
} from "./nav-prefs";

const all = [...navItems, ...workerOnlyItems];

describe("menu groups", () => {
  it("gives every section a home and a default place", () => {
    for (const item of all) {
      expect(NAV_GROUP_OF[item.key]).toBeDefined();
      expect(NAV_DEFAULT_ORDER).toContain(item.key);
    }
    expect(NAV_DEFAULT_ORDER).toHaveLength(all.length);
  });

  it("draws the owner's menu as four groups in the order of a day", () => {
    const groups = groupNavItems(navItems, EMPTY_NAV_PREFS);
    expect(groups.map((group) => group.key)).toEqual(["today", "sales", "business", "company"]);
    expect(groups[0]!.items.map((item) => item.key)).toEqual(["dashboard", "tasks", "calendar"]);
    expect(groups[1]!.items.map((item) => item.key)).toEqual([
      "contacts",
      "coldCalling",
      "pipeline",
      "scheduler",
    ]);
    expect(groups[2]!.items.map((item) => item.key)).toEqual(["milestones", "notes", "finance"]);
    expect(groups[3]!.items.map((item) => item.key)).toEqual(["workers", "messages"]);
    // Nothing is lost between the groups.
    expect(flattenNavGroups(groups)).toHaveLength(navItems.length);
  });

  it("drops a group a worker has nothing in", () => {
    const worker = navItemsFor({ permissions: { pipeline: { view: true, edit: false } } });
    const groups = groupNavItems(worker, EMPTY_NAV_PREFS);
    expect(groups.map((group) => group.key)).toEqual(["today", "sales", "business", "company"]);
    expect(groups.find((group) => group.key === "sales")!.items.map((item) => item.key)).toEqual([
      "pipeline",
    ]);
    const caller = navItemsFor({ permissions: {}, company: false });
    expect(groupNavItems(caller, EMPTY_NAV_PREFS).map((group) => group.key)).toEqual([
      "today",
      "business",
      "company",
    ]);
  });
});

describe("the person's own menu", () => {
  it("reads only known sections and never hides the dashboard", () => {
    expect(parseNavPrefs(null)).toEqual(EMPTY_NAV_PREFS);
    expect(parseNavPrefs("x")).toEqual(EMPTY_NAV_PREFS);
    expect(
      parseNavPrefs({ pinned: ["pipeline", "nope", "pipeline", 3], hidden: ["dashboard", "finance"], order: ["notes"] }),
    ).toEqual({ pinned: ["pipeline"], hidden: ["finance"], order: ["notes"] });
    expect(parseNavPrefs({ pinned: NAV_DEFAULT_ORDER }).pinned).toHaveLength(MAX_PINNED);
    expect(isDefaultNavPrefs(parseNavPrefs({}))).toBe(true);
  });

  it("puts pinned sections first, in the person's order, and leaves hidden ones out", () => {
    const prefs = parseNavPrefs({ pinned: ["pipeline", "notes"], hidden: ["scheduler"] });
    const groups = groupNavItems(navItems, prefs);
    expect(groups[0]).toEqual({ key: "pinned", items: [navItems.find((i) => i.key === "pipeline"), navItems.find((i) => i.key === "notes")] });
    const keys = flattenNavGroups(groups).map((item) => item.key);
    expect(keys).not.toContain("scheduler");
    expect(keys.filter((key) => key === "pipeline")).toHaveLength(1);
    expect(keys).toHaveLength(navItems.length - 1);
  });

  it("ignores a pinned or hidden section the account cannot open", () => {
    const worker = navItemsFor({ permissions: {} });
    const prefs = parseNavPrefs({ pinned: ["finance"], hidden: ["pipeline"] });
    const keys = flattenNavGroups(groupNavItems(worker, prefs)).map((item) => item.key);
    expect(keys).toEqual(["dashboard", "tasks", "notes", "workers", "messages", "myRewards"]);
  });

  it("reorders within a group without touching the others", () => {
    const today = ["dashboard", "tasks", "calendar"] as const;
    const moved = moveNavItem(EMPTY_NAV_PREFS, [...today], "calendar", -1);
    expect(moved.order).toEqual(["dashboard", "calendar", "tasks"]);
    const groups = groupNavItems(navItems, moved);
    expect(groups[0]!.items.map((item) => item.key)).toEqual(["dashboard", "calendar", "tasks"]);
    expect(groups[1]!.items.map((item) => item.key)).toEqual([
      "contacts",
      "coldCalling",
      "pipeline",
      "scheduler",
    ]);
    // Past the edge nothing happens; the same object comes back.
    expect(moveNavItem(moved, [...today], "dashboard", -1)).toBe(moved);
    // Pinned sections reorder among themselves.
    const pinned = parseNavPrefs({ pinned: ["notes", "pipeline"] });
    expect(moveNavItem(pinned, ["notes", "pipeline"], "pipeline", -1).pinned).toEqual(["pipeline", "notes"]);
  });

  it("pins up to the limit and unhides what it pins; hiding unpins", () => {
    let prefs = EMPTY_NAV_PREFS;
    for (const key of ["pipeline", "contacts", "notes", "finance", "calendar", "tasks"] as const) {
      prefs = togglePinned(prefs, key);
    }
    expect(prefs.pinned).toHaveLength(MAX_PINNED);
    expect(prefs.pinned).not.toContain("tasks");
    prefs = togglePinned(prefs, "pipeline");
    expect(prefs.pinned).not.toContain("pipeline");
    prefs = toggleHidden(prefs, "contacts");
    expect(prefs.hidden).toEqual(["contacts"]);
    expect(prefs.pinned).not.toContain("contacts");
    prefs = togglePinned(prefs, "contacts");
    expect(prefs.hidden).toEqual([]);
    expect(toggleHidden(prefs, "dashboard")).toBe(prefs);
  });

  it("fills the phone bar with pins first, the dashboard always, hidden sections never", () => {
    const available = navItems.map((item) => item.key);
    expect(bottomBarKeys(bottomNavKeys, EMPTY_NAV_PREFS, available)).toEqual(bottomNavKeys);
    const prefs = parseNavPrefs({ pinned: ["finance", "notes"], hidden: ["messages"] });
    expect(bottomBarKeys(bottomNavKeys, prefs, available)).toEqual([
      "dashboard",
      "finance",
      "notes",
      "milestones",
      "pipeline",
    ]);
    // A worker's defaults, with a section they cannot open skipped.
    expect(bottomBarKeys(["dashboard", "tasks", "messages", "myRewards"], parseNavPrefs({ pinned: ["finance"] }), ["dashboard", "tasks", "messages", "myRewards"])).toEqual([
      "dashboard",
      "tasks",
      "messages",
      "myRewards",
    ]);
  });

  it("lets the editor see hidden sections in their groups", () => {
    const prefs = parseNavPrefs({ hidden: ["finance"] });
    const keys = flattenNavGroups(navEditorGroups(navItems, prefs)).map((item) => item.key);
    expect(keys).toContain("finance");
  });
});

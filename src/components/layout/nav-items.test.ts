import { describe, expect, it } from "vitest";
import {
  bottomNavKeys,
  bottomNavKeysFor,
  isActivePath,
  isPathAllowed,
  navItems,
  navItemsFor,
} from "./nav-items";

describe("isActivePath", () => {
  it("matches the section and its sub-pages", () => {
    expect(isActivePath("/app/pipeline", "/app/pipeline")).toBe(true);
    expect(isActivePath("/app/pipeline/42", "/app/pipeline")).toBe(true);
  });

  it("does not match sections that only share a prefix", () => {
    expect(isActivePath("/app/kontakty-archive", "/app/kontakty")).toBe(false);
    expect(isActivePath("/app", "/app/kalendar")).toBe(false);
  });

  it("keeps the dashboard to its own address, not every page under /app", () => {
    expect(isActivePath("/app", "/app")).toBe(true);
    expect(isActivePath("/app/pipeline", "/app")).toBe(false);
  });
});

describe("navigation", () => {
  it("has eight sections, four of them in the phone bar", () => {
    expect(navItems).toHaveLength(8);
    expect(bottomNavKeys).toHaveLength(4);
    expect(bottomNavKeys.every((key) => navItems.some((item) => item.key === key))).toBe(true);
  });
});

describe("worker navigation", () => {
  const worker = {
    permissions: {
      pipeline: { view: true, edit: false },
      finance: { view: false, edit: false },
      workers: { view: true, edit: true },
    },
  };

  it("gives a worker their own three sections plus the ones they may see", () => {
    expect(navItemsFor(worker).map((item) => item.key)).toEqual([
      "dashboard",
      "myTasks",
      "myRewards",
      "pipeline",
    ]);
    expect(bottomNavKeysFor(worker)).toEqual(["dashboard", "myTasks", "myRewards"]);
  });

  it("opens the calendar only with the right to see it", () => {
    expect(isPathAllowed("/app/kalendar", worker)).toBe(false);
    const withCalendar = { permissions: { calendar: { view: true, edit: false } } };
    expect(navItemsFor(withCalendar).map((item) => item.key)).toContain("calendar");
    expect(isPathAllowed("/app/kalendar", withCalendar)).toBe(true);
  });

  it("keeps the owner's sidebar as it was", () => {
    expect(navItemsFor(null)).toBe(navItems);
    expect(bottomNavKeysFor(null)).toBe(bottomNavKeys);
  });

  it("closes sections outside the sidebar, never profile or settings", () => {
    expect(isPathAllowed("/app/pipeline/abc", worker)).toBe(true);
    expect(isPathAllowed("/app/finance", worker)).toBe(false);
    expect(isPathAllowed("/app/pracovnici", worker)).toBe(false);
    expect(isPathAllowed("/app/milniky", worker)).toBe(false);
    expect(isPathAllowed("/app/nastaveni", worker)).toBe(true);
    expect(isPathAllowed("/app/tarif", worker)).toBe(true);
    expect(isPathAllowed("/app/ukoly", null)).toBe(false);
    expect(isPathAllowed("/app/odmeny", null)).toBe(false);
    expect(isPathAllowed("/app/pracovnici/odmeny", null)).toBe(true);
  });
});

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
  it("has eleven sections, five of them in the phone bar", () => {
    expect(navItems).toHaveLength(11);
    expect(navItems.map((item) => item.key).slice(0, 3)).toEqual([
      "dashboard",
      "milestones",
      "notes",
    ]);
    expect(bottomNavKeys).toHaveLength(5);
    expect(bottomNavKeys).toContain("messages");
    // Tasks follow the pipeline.
    const keys = navItems.map((item) => item.key);
    expect(keys[keys.indexOf("pipeline") + 1]).toBe("tasks");
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

  it("gives a worker their own four sections plus the ones they may see", () => {
    expect(navItemsFor(worker).map((item) => item.key)).toEqual([
      "dashboard",
      "tasks",
      "messages",
      "myRewards",
      "pipeline",
      "workers",
    ]);
    expect(bottomNavKeysFor(worker)).toEqual(["dashboard", "tasks", "messages", "myRewards"]);
    expect(isPathAllowed("/app/zpravy", worker)).toBe(true);
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
    // Company with their own branch, never a worker's page or the reward system.
    expect(isPathAllowed("/app/firma", worker)).toBe(true);
    expect(isPathAllowed("/app/firma/abc", worker)).toBe(false);
    expect(isPathAllowed("/app/firma/odmeny", worker)).toBe(false);
    expect(isPathAllowed("/app/milniky", worker)).toBe(false);
    // The owner's notes stay private, whatever the worker may see.
    expect(isPathAllowed("/app/poznamky", worker)).toBe(false);
    expect(isPathAllowed("/app/poznamky", null)).toBe(true);
    expect(isPathAllowed("/app/nastaveni", worker)).toBe(true);
    expect(isPathAllowed("/app/tarif", worker)).toBe(true);
    // Tasks: one section for both; the old address of the worker's tasks redirects there.
    expect(isPathAllowed("/app/ukoly-crm", null)).toBe(true);
    expect(isPathAllowed("/app/ukoly-crm", worker)).toBe(true);
    expect(isPathAllowed("/app/odmeny", null)).toBe(false);
    expect(isPathAllowed("/app/firma/odmeny", null)).toBe(true);
    expect(isPathAllowed("/app/firma/abc", null)).toBe(true);
  });
});

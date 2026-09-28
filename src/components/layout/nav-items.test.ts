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
    expect(isActivePath("/pipeline", "/pipeline")).toBe(true);
    expect(isActivePath("/pipeline/42", "/pipeline")).toBe(true);
  });

  it("does not match sections that only share a prefix", () => {
    expect(isActivePath("/contacts-archive", "/contacts")).toBe(false);
    expect(isActivePath("/dashboard", "/calendar")).toBe(false);
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

  it("gives a worker their four sections plus the ones they may see", () => {
    expect(navItemsFor(worker).map((item) => item.key)).toEqual([
      "dashboard",
      "myTasks",
      "myRewards",
      "calendar",
      "pipeline",
    ]);
    expect(bottomNavKeysFor(worker)).toEqual(["dashboard", "myTasks", "myRewards", "calendar"]);
  });

  it("keeps the owner's sidebar as it was", () => {
    expect(navItemsFor(null)).toBe(navItems);
    expect(bottomNavKeysFor(null)).toBe(bottomNavKeys);
  });

  it("closes sections outside the sidebar, never profile or settings", () => {
    expect(isPathAllowed("/pipeline/abc", worker)).toBe(true);
    expect(isPathAllowed("/finance", worker)).toBe(false);
    expect(isPathAllowed("/workers", worker)).toBe(false);
    expect(isPathAllowed("/milestones", worker)).toBe(false);
    expect(isPathAllowed("/settings", worker)).toBe(true);
    expect(isPathAllowed("/tasks", null)).toBe(false);
    expect(isPathAllowed("/rewards", null)).toBe(false);
    expect(isPathAllowed("/workers/rewards", null)).toBe(true);
  });
});

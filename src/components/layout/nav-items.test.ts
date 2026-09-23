import { describe, expect, it } from "vitest";
import { bottomNavKeys, isActivePath, navItems } from "./nav-items";

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

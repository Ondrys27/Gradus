import { describe, expect, it } from "vitest";
import { HOME_PATH, loginUrlFor, routeKind, safeNextPath } from "./routes";

describe("routeKind", () => {
  it("classifies auth pages, open routes and the app", () => {
    expect(routeKind("/login")).toBe("guest");
    expect(routeKind("/register")).toBe("guest");
    expect(routeKind("/forgot-password")).toBe("guest");
    expect(routeKind("/reset-password")).toBe("reset");
    expect(routeKind("/auth/confirm")).toBe("open");
    expect(routeKind("/api/cron/stats")).toBe("open");
    expect(routeKind("/dashboard")).toBe("protected");
    expect(routeKind("/")).toBe("protected");
    expect(routeKind("/login-help")).toBe("protected");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin app paths with their query", () => {
    expect(safeNextPath("/pipeline?deal=1#notes")).toBe("/pipeline?deal=1#notes");
  });

  it("falls back home for anything that could leave the app", () => {
    for (const bad of [
      null,
      "",
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "dashboard",
    ]) {
      expect(safeNextPath(bad)).toBe(HOME_PATH);
    }
  });

  it("never sends a user back to an auth page", () => {
    expect(safeNextPath("/login")).toBe(HOME_PATH);
    expect(safeNextPath("/reset-password")).toBe(HOME_PATH);
  });
});

describe("loginUrlFor", () => {
  it("remembers where the visitor wanted to go", () => {
    expect(loginUrlFor("/contacts?table=2")).toBe("/login?next=%2Fcontacts%3Ftable%3D2");
    expect(loginUrlFor("/dashboard")).toBe("/login");
  });
});

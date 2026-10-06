import { describe, expect, it } from "vitest";
import { HOME_PATH, isResetPasswordPath, loginUrlFor, routeKind, safeNextPath } from "./routes";

describe("routeKind", () => {
  it("classifies sign-in pages in both languages", () => {
    for (const path of ["/prihlaseni", "/registrace", "/zapomenute-heslo"]) {
      expect(routeKind(path)).toBe("guest");
    }
    for (const path of ["/en/login", "/en/register", "/en/forgot-password"]) {
      expect(routeKind(path)).toBe("guest");
    }
    expect(routeKind("/nove-heslo")).toBe("reset");
    expect(routeKind("/en/reset-password")).toBe("reset");
  });

  it("keeps the marketing site public and the app protected", () => {
    for (const path of ["/", "/cenik", "/podminky", "/soukromi", "/en", "/en/pricing"]) {
      expect(routeKind(path)).toBe("public");
    }
    expect(routeKind("/app")).toBe("protected");
    expect(routeKind("/app/milniky/42")).toBe("protected");
    expect(routeKind("/application")).toBe("open");
    expect(routeKind("/auth/confirm")).toBe("open");
    expect(routeKind("/api/cron/stats")).toBe("open");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin app paths with their query", () => {
    expect(safeNextPath("/app/pipeline?deal=1#notes")).toBe("/app/pipeline?deal=1#notes");
  });

  it("falls back home for anything that could leave the app", () => {
    for (const bad of [
      null,
      "",
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "app",
      "/",
      "/cenik",
    ]) {
      expect(safeNextPath(bad)).toBe(HOME_PATH);
    }
  });

  it("never sends a user back to an auth page", () => {
    expect(safeNextPath("/prihlaseni")).toBe(HOME_PATH);
    expect(safeNextPath("/en/reset-password")).toBe(HOME_PATH);
  });
});

describe("loginUrlFor", () => {
  it("remembers where the visitor wanted to go, in their language", () => {
    expect(loginUrlFor("/app/kontakty?table=2")).toBe(
      "/prihlaseni?next=%2Fapp%2Fkontakty%3Ftable%3D2",
    );
    expect(loginUrlFor("/app", "en")).toBe("/en/login");
    expect(loginUrlFor("/app")).toBe("/prihlaseni");
  });
});

describe("isResetPasswordPath", () => {
  it("knows the reset page in both languages", () => {
    expect(isResetPasswordPath("/nove-heslo")).toBe(true);
    expect(isResetPasswordPath("/en/reset-password")).toBe(true);
    expect(isResetPasswordPath("/app")).toBe(false);
    expect(isResetPasswordPath(null)).toBe(false);
  });
});

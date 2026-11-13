import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearNavigating,
  markNavigating,
  NAV_PENDING_TIMEOUT_MS,
  pathOf,
  readPendingHref,
  shouldMarkPending,
} from "./nav-pending";

describe("nav pending", () => {
  afterEach(() => {
    clearNavigating();
    vi.useRealTimers();
  });

  it("compares paths without query, hash or a trailing slash", () => {
    expect(pathOf("/app/finance?tab=month#x")).toBe("/app/finance");
    expect(pathOf("/app/kontakty/")).toBe("/app/kontakty");
    expect(pathOf("/")).toBe("/");
  });

  it("marks only a change of page", () => {
    expect(shouldMarkPending("/app", "/app/kontakty")).toBe(true);
    expect(shouldMarkPending("/app/finance", "/app/finance?tab=month")).toBe(false);
    expect(shouldMarkPending("/app/kontakty/", "/app/kontakty")).toBe(false);
  });

  it("holds the clicked address until the page arrives", () => {
    markNavigating("/app", "/app/pipeline?tile=overdue");
    expect(readPendingHref()).toBe("/app/pipeline");
    clearNavigating();
    expect(readPendingHref()).toBeNull();
  });

  it("ignores a click on the page already shown", () => {
    markNavigating("/app/pipeline", "/app/pipeline");
    expect(readPendingHref()).toBeNull();
  });

  it("gives up when the page never arrives", () => {
    vi.useFakeTimers();
    markNavigating("/app", "/app/pipeline");
    vi.advanceTimersByTime(NAV_PENDING_TIMEOUT_MS - 1);
    expect(readPendingHref()).toBe("/app/pipeline");
    vi.advanceTimersByTime(1);
    expect(readPendingHref()).toBeNull();
  });
});

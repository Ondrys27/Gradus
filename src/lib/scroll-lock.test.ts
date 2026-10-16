import { afterEach, describe, expect, it } from "vitest";
import {
  lockPageScroll,
  PAGE_LOCK_ATTRIBUTE,
  pageScrollLockCount,
  releaseStrayPageLock,
} from "./scroll-lock";

const locked = () => document.documentElement.hasAttribute(PAGE_LOCK_ATTRIBUTE);

afterEach(() => {
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("page scroll lock", () => {
  it("stays locked until every holder lets go, in any order", () => {
    const tour = lockPageScroll();
    const detail = lockPageScroll();
    expect(locked()).toBe(true);
    tour();
    expect(locked()).toBe(true);
    detail();
    expect(locked()).toBe(false);
    expect(pageScrollLockCount()).toBe(0);
  });

  it("a release called twice counts once", () => {
    const first = lockPageScroll();
    const second = lockPageScroll();
    first();
    first();
    expect(locked()).toBe(true);
    second();
    expect(locked()).toBe(false);
  });

  it("never saves or restores inline styles, so another lock cannot be put back after it ended", () => {
    // A dialog's own lock is on while the tour starts…
    document.body.style.overflow = "hidden";
    const tour = lockPageScroll();
    // …the dialog lets go first…
    document.body.style.removeProperty("overflow");
    // …and the tour's end leaves nothing behind.
    tour();
    expect(document.body.style.overflow).toBe("");
    expect(locked()).toBe(false);
  });
});

describe("stray lock after a page change", () => {
  it("clears a leftover overflow and pointer-events lock when nothing holds it", () => {
    document.body.style.overflow = "hidden";
    document.body.style.pointerEvents = "none";
    document.documentElement.style.overflowY = "hidden";
    expect(releaseStrayPageLock()).toBe(true);
    expect(document.body.getAttribute("style") ?? "").toBe("");
    expect(document.documentElement.style.overflowY).toBe("");
  });

  it("leaves a lock alone while an overlay holds it", () => {
    const release = lockPageScroll();
    document.body.style.overflow = "hidden";
    expect(releaseStrayPageLock()).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
    release();
  });

  it("leaves a lock alone while a dialog is on screen", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    // jsdom has no layout; a dialog on screen has a box.
    dialog.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.append(dialog);
    document.body.style.overflow = "hidden";
    expect(releaseStrayPageLock()).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("does nothing when the page is not locked", () => {
    document.body.style.overflowX = "auto";
    expect(releaseStrayPageLock()).toBe(false);
    expect(document.body.style.overflowX).toBe("auto");
  });
});

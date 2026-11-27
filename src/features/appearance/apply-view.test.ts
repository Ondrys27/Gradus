import { afterEach, describe, expect, it } from "vitest";
import { applyView } from "./apply-view";
import { builtinView, customView, tokensFromBuiltin } from "./custom-tokens";

afterEach(() => {
  const html = document.documentElement;
  html.removeAttribute("style");
  for (const name of [...html.getAttributeNames()]) if (name.startsWith("data-")) html.removeAttribute(name);
  document.cookie = "theme=; max-age=0; path=/";
});

describe("applyView", () => {
  it("puts a custom theme's variables and attributes on <html> and the base in the cookie", () => {
    const tokens = { ...tokensFromBuiltin("light"), headingFont: "sora" as const, density: "compact" as const };
    applyView(customView(tokens));
    const html = document.documentElement;
    expect(html.dataset.theme).toBe("light");
    expect(html.style.getPropertyValue("--color-violet")).toBe(tokens.colors.accent);
    expect(html.getAttribute("data-heading-font")).toBe("sora");
    expect(html.getAttribute("data-density")).toBe("compact");
    expect(html.hasAttribute("data-custom-theme")).toBe(true);
    expect(document.cookie).toContain("theme=light");
  });

  it("a built-in theme afterwards removes all of it, also what the server painted", () => {
    const html = document.documentElement;
    // As the server's first paint would leave it.
    html.style.setProperty("--color-canvas", "#101010");
    html.style.setProperty("--radius-card", "4px");
    html.style.setProperty("--app-sidebar-width", "10px");
    html.setAttribute("data-backdrop", "solid");
    applyView(builtinView("forest"));
    expect(html.dataset.theme).toBe("forest");
    expect(html.style.getPropertyValue("--color-canvas")).toBe("");
    expect(html.style.getPropertyValue("--radius-card")).toBe("");
    // Not ours: left alone.
    expect(html.style.getPropertyValue("--app-sidebar-width")).toBe("10px");
    expect(html.hasAttribute("data-backdrop")).toBe(false);
    expect(document.cookie).toContain("theme=forest");
  });
});

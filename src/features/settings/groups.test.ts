import { describe, expect, it } from "vitest";
import {
  SETTINGS_GROUP_DEFS,
  SETTINGS_ITEMS,
  settingsGroupOf,
  settingsHref,
  settingsItemHref,
  visibleSettingsGroups,
  visibleSettingsItems,
} from "./groups";

describe("settings catalog", () => {
  it("gives every item its own deep-link target the focus handler accepts", () => {
    const targets = SETTINGS_ITEMS.map((item) => item.target);
    expect(new Set(targets).size).toBe(targets.length);
    for (const target of targets) expect(target).toMatch(/^settings-[a-z-]+$/);
  });

  it("links every item into its own group page", () => {
    for (const item of SETTINGS_ITEMS) {
      const href = settingsItemHref(item);
      const [path] = href.split("?");
      expect(settingsGroupOf(path)).toBe(item.group);
      expect(href).toContain(`?focus=${item.target}`);
    }
  });

  it("builds deep links from elsewhere in the app by id", () => {
    expect(settingsHref("gradyFrequency")).toBe(
      "/app/nastaveni/grady?focus=settings-grady-frequency",
    );
    expect(settingsHref("country")).toBe("/app/nastaveni/vzhled?focus=settings-country");
  });

  it("has no Integrations item: the Grady test lives in the administration", () => {
    expect(SETTINGS_ITEMS.some((item) => /integration|ping|gradyTest/i.test(item.id))).toBe(false);
  });

  it("shows a worker neither the subscription nor the owner's business settings", () => {
    const worker = { owner: false, worker: true, caller: false };
    const groups = visibleSettingsGroups(worker).map((def) => def.key);
    expect(groups).not.toContain("subscription");
    const items = visibleSettingsItems(worker).map((item) => item.id);
    expect(items).not.toContain("invoices");
    expect(items).not.toContain("gradyFrequency");
    expect(items).toContain("tour");
  });

  it("shows the owner every group", () => {
    const owner = { owner: true, worker: false, caller: true };
    expect(visibleSettingsGroups(owner)).toHaveLength(SETTINGS_GROUP_DEFS.length);
    expect(visibleSettingsItems(owner)).toHaveLength(SETTINGS_ITEMS.length);
  });
});

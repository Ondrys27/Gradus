import { describe, expect, it } from "vitest";
import { parseEvent } from "./events";
import { settingsEvents } from "./settings-events";

describe("settingsEvents", () => {
  it("names the setting and passes codes and switches only", () => {
    const events = settingsEvents({
      locale: "cs",
      currency: "CZK",
      timezone: "Europe/Prague",
      date_format: "d. M. yyyy",
      theme: "midnight",
      animations_enabled: false,
      jarvis_quiet_from: 22,
      jarvis_quiet_to: 7,
    });
    expect(events).toEqual([
      { setting: "locale", value: "cs" },
      { setting: "currency", value: "CZK" },
      { setting: "timezone" },
      { setting: "date_format" },
      { setting: "theme", value: "midnight" },
      { setting: "animations", enabled: false },
      { setting: "jarvis_quiet_hours", enabled: true },
    ]);
    for (const props of events)
      expect(parseEvent("settings_changed", props, "client").ok).toBe(true);
  });

  it("says whether a Cold Calling deal stage was picked, never which one", () => {
    const picked = settingsEvents({
      cold_calling_deal_stage_id: "8f0e7a52-3c1b-4f7e-9a51-0d6c2b9e4a10",
    });
    expect(picked).toEqual([{ setting: "cold_calling_deal_stage", enabled: true }]);
    expect(settingsEvents({ cold_calling_deal_stage_id: null })).toEqual([
      { setting: "cold_calling_deal_stage", enabled: false },
    ]);
    expect(parseEvent("settings_changed", picked[0]!, "client").ok).toBe(true);
  });

  it("tracks the sidebar collapsing as a switch", () => {
    const collapsed = settingsEvents({ sidebar_collapsed: true });
    expect(collapsed).toEqual([{ setting: "sidebar_collapsed", enabled: true }]);
    expect(settingsEvents({ sidebar_collapsed: false })).toEqual([
      { setting: "sidebar_collapsed", enabled: false },
    ]);
    expect(parseEvent("settings_changed", collapsed[0]!, "client").ok).toBe(true);
  });

  it("ignores columns that are not settings people choose", () => {
    expect(settingsEvents({ updated_at: "2026-10-08T00:00:00Z" })).toEqual([]);
  });
});

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

  it("ignores columns that are not settings people choose", () => {
    expect(settingsEvents({ updated_at: "2026-10-08T00:00:00Z" })).toEqual([]);
  });
});

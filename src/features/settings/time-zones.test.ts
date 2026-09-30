import { describe, expect, it } from "vitest";
import { formatUtcOffset, utcOffsetMinutes } from "@/lib/format";
import { groupZones, searchKey, zoneContinent, zoneLabel, zoneMatches } from "./time-zones";

const cs = (continent: string) =>
  ({ Europe: "Evropa", America: "Amerika", Asia: "Asie", Other: "Ostatní" })[continent] ??
  continent;

describe("time zone labels", () => {
  it("puts the continent in the UI language", () => {
    expect(zoneLabel("Europe/Prague", cs)).toBe("Evropa/Prague");
    expect(zoneLabel("America/Argentina/Buenos_Aires", cs)).toBe("Amerika/Argentina/Buenos Aires");
    expect(zoneLabel("UTC", cs)).toBe("UTC");
    expect(zoneContinent("Etc/GMT+2")).toBe("Other");
  });

  it("searches without diacritics, in either language", () => {
    expect(searchKey("Évropa/Praha_Nové")).toBe("evropa praha nove");
    expect(zoneMatches("Europe/Prague", "Evropa/Prague", "evropa prag")).toBe(true);
    expect(zoneMatches("Europe/Prague", "Evropa/Prague", "europe")).toBe(true);
    expect(zoneMatches("Europe/Prague", "Evropa/Prague", "Ásie")).toBe(false);
    expect(zoneMatches("Europe/Prague", "Evropa/Prague", "  ")).toBe(true);
  });

  it("groups by continent in a fixed order, sorted inside", () => {
    const groups = groupZones(
      ["Asia/Tokyo", "Europe/Vienna", "UTC", "Europe/Berlin", "America/New_York", "Europe/Berlin"],
      cs,
      "cs",
    );
    expect(groups).toEqual([
      { value: "Europe", items: ["Europe/Berlin", "Europe/Vienna"] },
      { value: "America", items: ["America/New_York"] },
      { value: "Asia", items: ["Asia/Tokyo"] },
      { value: "Other", items: ["UTC"] },
    ]);
  });
});

describe("UTC offsets", () => {
  const summer = new Date("2026-07-01T12:00:00Z");
  const winter = new Date("2026-01-15T12:00:00Z");

  it("follows daylight saving time", () => {
    expect(formatUtcOffset("Europe/Prague", summer)).toBe("UTC+2");
    expect(formatUtcOffset("Europe/Prague", winter)).toBe("UTC+1");
    expect(formatUtcOffset("America/New_York", winter)).toBe("UTC-5");
  });

  it("writes half and quarter hours and plain UTC", () => {
    expect(formatUtcOffset("Asia/Kolkata", winter)).toBe("UTC+5:30");
    expect(formatUtcOffset("Asia/Kathmandu", winter)).toBe("UTC+5:45");
    expect(formatUtcOffset("America/St_Johns", winter)).toBe("UTC-3:30");
    expect(formatUtcOffset("UTC", winter)).toBe("UTC");
    expect(utcOffsetMinutes("Europe/London", winter)).toBe(0);
  });
});

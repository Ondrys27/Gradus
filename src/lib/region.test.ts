import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryFromTimeZone, isValidTimeZone, regionFormats } from "./region";

describe("countryFromTimeZone", () => {
  it("derives the country from the browser zone", () => {
    expect(countryFromTimeZone("Europe/Prague")).toBe("CZ");
    expect(countryFromTimeZone("Europe/Bratislava")).toBe("SK");
    expect(countryFromTimeZone("America/New_York")).toBe("US");
    expect(countryFromTimeZone("Europe/Kiev")).toBe("UA"); // legacy name some browsers report
  });

  it("returns null for zones without a country", () => {
    expect(countryFromTimeZone("UTC")).toBeNull();
    expect(countryFromTimeZone("Etc/GMT+2")).toBeNull();
  });
});

describe("regionFormats", () => {
  it("starts Czech and American accounts with their own conventions", () => {
    expect(regionFormats("CZ")).toMatchObject({
      currency: "CZK",
      numberFormat: "cs",
      weekStartsOn: 1,
    });
    expect(regionFormats("US")).toMatchObject({
      currency: "USD",
      dateFormat: "MM/dd/yyyy",
      timeFormat: "h:mm a",
      weekStartsOn: 0,
    });
  });

  it("uses euro for eurozone countries without a preset", () => {
    expect(regionFormats("PT").currency).toBe("EUR");
  });
});

describe("country list", () => {
  it("contains unique two-letter codes", () => {
    expect(COUNTRY_CODES).toContain("CZ");
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Europe/Prague")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

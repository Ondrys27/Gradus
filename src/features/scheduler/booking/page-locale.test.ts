import { describe, expect, it } from "vitest";
import { acceptedLanguages, bookingCookie, bookingLocale, readCookie } from "./page-locale";

describe("the booking page's language", () => {
  it("reads Accept-Language by weight", () => {
    expect(acceptedLanguages("de-DE,de;q=0.9,en;q=0.8,cs;q=0.7")).toEqual(["de", "de", "en", "cs"]);
    expect(acceptedLanguages("cs;q=0.5, en-GB")).toEqual(["en", "cs"]);
    expect(acceptedLanguages("*, fr;q=0")).toEqual([]);
    expect(acceptedLanguages(null)).toEqual([]);
  });

  it("the guest's pick, then the browser's first Czech or English, then the host's, then English", () => {
    expect(bookingLocale({ chosen: "en", acceptLanguage: "cs", hostLocale: "cs" })).toBe("en");
    expect(bookingLocale({ chosen: "xx", acceptLanguage: "cs-CZ,cs;q=0.9", hostLocale: "en" })).toBe("cs");
    expect(bookingLocale({ acceptLanguage: "de,en;q=0.5", hostLocale: "cs" })).toBe("en");
    expect(bookingLocale({ acceptLanguage: "de,fr", hostLocale: "cs" })).toBe("cs");
    expect(bookingLocale({ acceptLanguage: "de", hostLocale: "de" })).toBe("en");
  });
});

describe("the page's own cookies", () => {
  it("are written for /s only and read back", () => {
    const cookie = bookingCookie("gradus_booking_tz", "America/New_York");
    expect(cookie).toContain("path=/s");
    expect(cookie).toContain("America%2FNew_York");
    expect(readCookie("a=1; gradus_booking_tz=America%2FNew_York; b=2", "gradus_booking_tz")).toBe(
      "America/New_York",
    );
    expect(readCookie("a=1", "gradus_booking_tz")).toBeNull();
  });
});

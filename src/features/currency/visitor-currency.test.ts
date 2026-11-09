import { describe, expect, it } from "vitest";
import { geoCurrency, pageCurrency, readCookie, visitorCurrency } from "./visitor-currency";

describe("the price list's currency", () => {
  it("is the page's own without any hint: CZK in Czech, EUR in English", () => {
    expect(pageCurrency("cs")).toBe("CZK");
    expect(pageCurrency("en")).toBe("EUR");
    expect(visitorCurrency("en", {})).toBe("EUR");
  });

  it("follows the link, then the visitor's pick, the account, the country", () => {
    const hints = { param: "jpy", picked: "USD", user: "PLN", geo: "GBP" };
    expect(visitorCurrency("cs", hints)).toBe("JPY");
    expect(visitorCurrency("cs", { ...hints, param: null })).toBe("USD");
    expect(visitorCurrency("cs", { ...hints, param: null, picked: null })).toBe("PLN");
    expect(visitorCurrency("cs", { geo: "GBP" })).toBe("GBP");
    // Nonsense is ignored, never shown.
    expect(visitorCurrency("en", { param: "XXX", picked: "<b>", geo: "HRK" })).toBe("EUR");
  });

  it("reads the country Vercel saw", () => {
    expect(geoCurrency("US")).toBe("USD");
    expect(geoCurrency("jp")).toBe("JPY");
    expect(geoCurrency("XX")).toBeNull();
    expect(geoCurrency("USA")).toBeNull();
    expect(geoCurrency(null)).toBeNull();
  });

  it("reads one cookie", () => {
    expect(readCookie("a=1; gradus_geo_currency=USD; b=2", "gradus_geo_currency")).toBe("USD");
    expect(readCookie("a=1", "gradus_geo_currency")).toBeNull();
  });
});

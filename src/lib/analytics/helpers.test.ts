import { describe, expect, it } from "vitest";
import { browserOf, deviceOf } from "./device";
import { routeOf, sectionOf } from "./routes";
import { scrubMessage } from "./scrub";

describe("scrubMessage", () => {
  it("removes e-mails and numbers longer than 4 digits", () => {
    expect(scrubMessage("Cannot load jan.novak@firma.cz (row 123456, year 2026)")).toBe(
      "Cannot load [email] (row [n], year 2026)",
    );
  });

  it("cuts to 200 characters and never leaves it empty", () => {
    expect(scrubMessage("a ".repeat(300)).length).toBeLessThanOrEqual(200);
    expect(scrubMessage("")).toBe("unknown");
    expect(scrubMessage(undefined)).toBe("unknown");
  });
});

describe("routeOf", () => {
  it("replaces ids with [id] and keeps fixed sub-pages", () => {
    expect(routeOf("/app")).toBe("/app");
    expect(routeOf("/app/kontakty/5b8f2c1e-1111-4222-8333-944455556666")).toBe(
      "/app/kontakty/[id]",
    );
    expect(routeOf("/app/kontakty/tabulky")).toBe("/app/kontakty/tabulky");
    expect(routeOf("/app/pracovnici/odmeny/")).toBe("/app/pracovnici/odmeny");
    expect(routeOf("/app/milniky/abc?x=1")).toBe("/app/milniky/[id]");
  });

  it("calls anything unknown other", () => {
    expect(routeOf("/app/kontakty/abc/def")).toBe("other");
    expect(routeOf("/something")).toBe("other");
    expect(sectionOf(routeOf("/app/cold-calling"))).toBe("cold_calling");
  });
});

describe("device and browser", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const ipad =
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const chrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const edge = `${chrome} Edg/130.0`;
  const androidTablet =
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

  it("tells phone, tablet and computer apart", () => {
    expect(deviceOf(iphone)).toBe("mobile");
    expect(deviceOf(ipad)).toBe("tablet");
    expect(deviceOf(androidTablet)).toBe("tablet");
    expect(deviceOf(chrome)).toBe("desktop");
    expect(deviceOf(null)).toBe("desktop");
  });

  it("names the browser family only", () => {
    expect(browserOf(iphone)).toBe("safari");
    expect(browserOf(chrome)).toBe("chrome");
    expect(browserOf(edge)).toBe("edge");
    expect(browserOf("curl/8.0")).toBe("other");
  });
});

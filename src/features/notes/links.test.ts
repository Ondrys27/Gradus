import { describe, expect, it } from "vitest";
import { isAllowedLink, normalizeLink } from "./links";

describe("normalizeLink", () => {
  it("adds https to a bare address and keeps full ones", () => {
    expect(normalizeLink("gradus.app")).toBe("https://gradus.app/");
    expect(normalizeLink(" https://example.com/cenik?x=1 ")).toBe("https://example.com/cenik?x=1");
    expect(normalizeLink("http://example.com")).toBe("http://example.com/");
  });

  it("turns an e-mail into mailto", () => {
    expect(normalizeLink("info@kavarna.cz")).toBe("mailto:info@kavarna.cz");
  });

  it("refuses scripts, data and nonsense", () => {
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeLink("ahoj")).toBeNull();
    expect(normalizeLink("   ")).toBeNull();
  });

  it("allows only web and mail links into a note", () => {
    expect(isAllowedLink("https://a.cz")).toBe(true);
    expect(isAllowedLink("mailto:a@b.cz")).toBe(true);
    expect(isAllowedLink("javascript:alert(1)")).toBe(false);
    expect(isAllowedLink("vbscript:x")).toBe(false);
  });
});

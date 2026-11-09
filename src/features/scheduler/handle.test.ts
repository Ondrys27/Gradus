import { describe, expect, it } from "vitest";
import {
  bookingUrl,
  handleCandidates,
  handleFromName,
  handleProblem,
  isValidSlug,
  normalizeHandleInput,
  uniqueSlug,
} from "./handle";
import { activePresetCount } from "./presets";

describe("handles", () => {
  it("come from the name without diacritics", () => {
    expect(handleFromName("Ondřej Otava")).toBe("ondrej-otava");
    expect(handleFromName("  Žluťoučký   kůň ")).toBe("zlutoucky-kun");
    expect(handleFromName("Al")).toBe("meet-al");
    expect(handleFromName("")).toBe("meet");
    expect(handleFromName("admin")).toBe("meet-admin");
    expect(handleFromName("x".repeat(40))).toHaveLength(30);
  });

  it("are checked like the database checks them", () => {
    expect(handleProblem("ondrej")).toBeNull();
    expect(handleProblem("ab")).toBe("tooShort");
    expect(handleProblem("a".repeat(31))).toBe("tooLong");
    expect(handleProblem("-abc")).toBe("format");
    expect(handleProblem("a--b")).toBe("format");
    expect(handleProblem("Ondrej")).toBe("format");
    expect(handleProblem("api")).toBe("reserved");
    expect(normalizeHandleInput("Ondřej Otava!")).toBe("ondrej-otava-");
  });

  it("offer numbered alternatives within 30 characters", () => {
    expect(handleCandidates("ondrej", 3)).toEqual(["ondrej", "ondrej-2", "ondrej-3"]);
    const long = handleCandidates("a".repeat(30), 2);
    expect(long[1]).toBe(`${"a".repeat(28)}-2`);
    for (const candidate of long) expect(candidate.length).toBeLessThanOrEqual(30);
  });

  it("slugs are unique among the person's types", () => {
    expect(uniqueSlug("Úvodní hovor", [])).toBe("uvodni-hovor");
    expect(uniqueSlug("Úvodní hovor", ["uvodni-hovor", "uvodni-hovor-2"])).toBe("uvodni-hovor-3");
    expect(uniqueSlug("!!!", [])).toBe("meeting");
    expect(isValidSlug("konzultace")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("-a")).toBe(false);
  });

  it("builds the public address", () => {
    expect(bookingUrl("https://gradus.app/", "ondrej", "konzultace")).toBe(
      "https://gradus.app/s/ondrej/konzultace",
    );
    expect(bookingUrl("https://gradus.app", "ondrej")).toBe("https://gradus.app/s/ondrej");
  });

  it("starts as many presets active as the plan allows", () => {
    expect(activePresetCount(1)).toBe(1);
    expect(activePresetCount(null)).toBe(3);
    expect(activePresetCount(0)).toBe(0);
    expect(activePresetCount(10)).toBe(3);
  });
});

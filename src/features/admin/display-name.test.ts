import { describe, expect, it } from "vitest";
import { displayName, idSuffix } from "./display-name";

const ID = "3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a1234";
const unnamed = (suffix: string) => `Unnamed account · ${suffix}`;

describe("displayName", () => {
  it("prefers the profile name", () => {
    expect(displayName(ID, { name: "Jana Nováková", email: "jana@example.com" }, unnamed)).toBe(
      "Jana Nováková",
    );
  });

  it("trims the name", () => {
    expect(displayName(ID, { name: "  Petr  ", email: null }, unnamed)).toBe("Petr");
  });

  it("falls back to the e-mail when the name is missing or blank", () => {
    expect(displayName(ID, { name: null, email: "petr@example.com" }, unnamed)).toBe("petr@example.com");
    expect(displayName(ID, { name: "   ", email: "petr@example.com" }, unnamed)).toBe(
      "petr@example.com",
    );
  });

  it("names an account without name and e-mail by the end of its id", () => {
    expect(displayName(ID, { name: null, email: " " }, unnamed)).toBe("Unnamed account · 1234");
    expect(displayName(ID, undefined, unnamed)).toBe("Unnamed account · 1234");
    expect(displayName(ID, null, unnamed)).toBe("Unnamed account · 1234");
  });
});

describe("idSuffix", () => {
  it("takes the last four characters, never a dash", () => {
    expect(idSuffix(ID)).toBe("1234");
    expect(idSuffix("abc-de")).toBe("bcde");
  });
});

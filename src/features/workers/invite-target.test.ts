import { describe, expect, it } from "vitest";
import { accountTargetValue, parseAccountTarget, parseInviteTarget } from "./invite-target";

describe("parseInviteTarget", () => {
  it("tells a short id from an e-mail", () => {
    expect(parseInviteTarget(" 7k3m9q ")).toEqual({ ok: true, target: { kind: "id", publicId: "7K3M9Q" } });
    expect(parseInviteTarget("7K3-M9Q")).toEqual({ ok: true, target: { kind: "id", publicId: "7K3M9Q" } });
    expect(parseInviteTarget(" Vaclav@Example.com ")).toEqual({
      ok: true,
      target: { kind: "email", email: "vaclav@example.com" },
    });
  });

  it("reads @name and any other valid username as a username (28.1)", () => {
    expect(parseInviteTarget("@Jana.Novak")).toEqual({
      ok: true,
      target: { kind: "username", username: "jana.novak" },
    });
    expect(parseInviteTarget("jana_n")).toEqual({ ok: true, target: { kind: "username", username: "jana_n" } });
    // Not the short id alphabet (O), so a username of the same letters.
    expect(parseInviteTarget("7K3M9O")).toEqual({ ok: true, target: { kind: "username", username: "7k3m9o" } });
  });

  it("refuses broken e-mails, bad usernames and spaces", () => {
    for (const value of ["jan@", "a@b", "@ab", "@jan novák", "no one", "x".repeat(21), "jan-novak"]) {
      expect(parseInviteTarget(value), value).toEqual({ ok: false, error: "targetInvalid" });
    }
    expect(parseInviteTarget("  ")).toEqual({ ok: false, error: "targetRequired" });
  });
});

describe("parseAccountTarget", () => {
  it("never takes an e-mail", () => {
    expect(parseAccountTarget("jana@example.com")).toEqual({ ok: false, error: "targetInvalid" });
  });

  it("sends a username with its @ and a short id as is", () => {
    const username = parseAccountTarget("@karel");
    const id = parseAccountTarget("7k3m9q");
    expect(username.ok && accountTargetValue(username.target)).toBe("@karel");
    expect(id.ok && accountTargetValue(id.target)).toBe("7K3M9Q");
  });
});

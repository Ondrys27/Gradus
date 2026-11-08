import { describe, expect, it } from "vitest";
import { parseInviteTarget } from "./invite-target";

describe("parseInviteTarget", () => {
  it("tells a short id from an e-mail", () => {
    expect(parseInviteTarget(" 7k3m9q ")).toEqual({ ok: true, target: { kind: "id", publicId: "7K3M9Q" } });
    expect(parseInviteTarget("7K3-M9Q")).toEqual({ ok: true, target: { kind: "id", publicId: "7K3M9Q" } });
    expect(parseInviteTarget(" Vaclav@Example.com ")).toEqual({
      ok: true,
      target: { kind: "email", email: "vaclav@example.com" },
    });
  });

  it("refuses look-alike characters, wrong lengths and broken e-mails", () => {
    for (const value of ["7K3M9O", "7K3M91", "7K3M9", "7K3M9QQ", "jan@", "@example.com", "no one"]) {
      expect(parseInviteTarget(value), value).toEqual({ ok: false, error: "targetInvalid" });
    }
    expect(parseInviteTarget("  ")).toEqual({ ok: false, error: "targetRequired" });
  });
});

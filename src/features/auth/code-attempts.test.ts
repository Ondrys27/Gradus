import { describe, expect, it } from "vitest";
import { CODE_ATTEMPT_LIMITS, codeLockedUntil, type CodeAttemptRow } from "./code-attempts";

const now = new Date("2026-11-12T10:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const row = (minutes: number, values: Partial<CodeAttemptRow> = {}): CodeAttemptRow => ({
  ip_hash: "ip-a",
  account_hash: null,
  stage: "submit",
  created_at: minutesAgo(minutes),
  ...values,
});
const keys = { ip: "ip-a", account: "mail-a" };

describe("codeLockedUntil", () => {
  it("pauses an address after five wrong codes in sent forms within 15 minutes", () => {
    const four = [10, 8, 6, 4].map((m) => row(m));
    expect(codeLockedUntil(four, keys, now)).toBeNull();
    const five = [...four, row(2)];
    expect(codeLockedUntil(five, keys, now)).toEqual(
      new Date(new Date(minutesAgo(2)).getTime() + CODE_ATTEMPT_LIMITS.lockoutMs),
    );
  });

  it("pauses an e-mail tried from many addresses", () => {
    const rows = [1, 2, 3, 4, 5].map((m, index) => row(m, { ip_hash: `ip-${index}`, account_hash: "mail-a" }));
    expect(codeLockedUntil(rows, keys, now)).not.toBeNull();
    expect(codeLockedUntil(rows, { ip: "ip-a", account: null }, now)).toBeNull();
  });

  it("forgets failures older than the window and pauses that already ended", () => {
    expect(codeLockedUntil([40, 35, 30, 25, 20].map((m) => row(m)), keys, now)).toBeNull();
    expect(codeLockedUntil([50, 48, 46, 44, 2].map((m) => row(m)), keys, now)).toBeNull();
  });

  it("lets the field check while typing more often, but not without end", () => {
    const checks = (count: number) => Array.from({ length: count }, (_, i) => row(14 - i * 0.5, { stage: "check" }));
    expect(codeLockedUntil(checks(CODE_ATTEMPT_LIMITS.check - 1), keys, now)).toBeNull();
    expect(codeLockedUntil(checks(CODE_ATTEMPT_LIMITS.check), keys, now)).not.toBeNull();
    // Checks never count against the e-mail: the field has none.
    expect(
      codeLockedUntil(
        checks(10).map((r) => ({ ...r, ip_hash: "ip-other", account_hash: "mail-a" })),
        keys,
        now,
      ),
    ).toBeNull();
  });

  it("counts other addresses for nobody else", () => {
    const rows = [5, 4, 3, 2, 1].map((m) => row(m, { ip_hash: "ip-b" }));
    expect(codeLockedUntil(rows, keys, now)).toBeNull();
  });
});

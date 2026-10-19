import { describe, expect, it } from "vitest";
import { auditDetailUser, describeAuditDetail } from "./audit-detail";

const nameOf = (id: string) => (id.startsWith("0b7c") ? "Jana" : `Unnamed · ${id.slice(-4)}`);

describe("describeAuditDetail", () => {
  it("lists only the changed fields, from → to", () => {
    expect(
      describeAuditDetail(
        {
          key: "ai_caps",
          from: { monthly_usd: 90, per_user_usd: null, warn_percent: 80 },
          to: { monthly_usd: 120, per_user_usd: 5, warn_percent: 80 },
        },
        "none",
        nameOf,
      ),
    ).toBe("monthly_usd: 90 → 120 · per_user_usd: none → 5");
  });

  it("shows the first save and a removed exception with the user", () => {
    expect(
      describeAuditDetail({ key: "ai_caps", from: null, to: { monthly_usd: 50 } }, "–", nameOf),
    ).toBe("monthly_usd: – → 50");
    expect(
      describeAuditDetail(
        {
          user: "0b7c1f2e-1111-2222-3333-444455556666",
          from: { cap_usd: null, blocked: true },
          to: null,
        },
        "–",
        nameOf,
      ),
    ).toBe("Jana · blocked: true → –");
  });

  it("is empty for views and exports", () => {
    expect(describeAuditDetail(null, "–", nameOf)).toBe("");
    expect(describeAuditDetail("text", "–", nameOf)).toBe("");
  });

  it("finds the user a change was about", () => {
    expect(auditDetailUser({ user: "abc", from: null })).toBe("abc");
    expect(auditDetailUser({ key: "ai_caps" })).toBeNull();
    expect(auditDetailUser(null)).toBeNull();
  });
});

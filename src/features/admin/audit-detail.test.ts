import { describe, expect, it } from "vitest";
import { describeAuditDetail } from "./audit-detail";

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
      ),
    ).toBe("monthly_usd: 90 → 120 · per_user_usd: none → 5");
  });

  it("shows the first save and a removed exception with the user", () => {
    expect(
      describeAuditDetail({ key: "ai_caps", from: null, to: { monthly_usd: 50 } }, "–"),
    ).toBe("monthly_usd: – → 50");
    expect(
      describeAuditDetail(
        {
          user: "0b7c1f2e-1111-2222-3333-444455556666",
          from: { cap_usd: null, blocked: true },
          to: null,
        },
        "–",
      ),
    ).toBe("0b7c1f2e · blocked: true → –");
  });

  it("is empty for views and exports", () => {
    expect(describeAuditDetail(null, "–")).toBe("");
    expect(describeAuditDetail("text", "–")).toBe("");
  });
});

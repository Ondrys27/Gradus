import { describe, expect, it } from "vitest";
import { parseSignupPlan, registerHref, signupPlanSearch } from "./signup-plan";

describe("parseSignupPlan", () => {
  it("reads the plan and the period the website writes", () => {
    expect(parseSignupPlan({ tarif: "pro", obdobi: "rok" })).toEqual({ planKey: "pro", billing: "yearly" });
    expect(parseSignupPlan({ tarif: "team", obdobi: "mesic" })).toEqual({ planKey: "team", billing: "monthly" });
    expect(parseSignupPlan(new URLSearchParams("tarif=solo&obdobi=rok"))).toEqual({
      planKey: "solo",
      billing: "yearly",
    });
  });

  it("takes English names, other spellings and case", () => {
    expect(parseSignupPlan({ plan: "PRO", period: "year" })).toEqual({ planKey: "pro", billing: "yearly" });
    expect(parseSignupPlan({ tarif: " Team ", obdobi: "Ročně".normalize("NFD").replace(/\p{M}/gu, "") })).toEqual({
      planKey: "team",
      billing: "yearly",
    });
    expect(parseSignupPlan({ tarif: "pro", billing: "yearly" })).toEqual({ planKey: "pro", billing: "yearly" });
    expect(parseSignupPlan({ tarif: ["solo", "team"], obdobi: ["rok"] })).toEqual({
      planKey: "solo",
      billing: "yearly",
    });
  });

  it("is monthly without a period or with one it does not know", () => {
    expect(parseSignupPlan({ tarif: "pro" })).toEqual({ planKey: "pro", billing: "monthly" });
    expect(parseSignupPlan({ tarif: "pro", obdobi: "tyden" })).toEqual({ planKey: "pro", billing: "monthly" });
  });

  it("ignores anything that is not a plan of the catalog", () => {
    expect(parseSignupPlan({})).toBeNull();
    expect(parseSignupPlan({ tarif: "beta", obdobi: "rok" })).toBeNull();
    expect(parseSignupPlan({ tarif: "enterprise" })).toBeNull();
    expect(parseSignupPlan({ tarif: "" })).toBeNull();
    expect(parseSignupPlan({ obdobi: "rok" })).toBeNull();
    expect(parseSignupPlan({ tarif: "pro".repeat(20) })).toBeNull();
  });
});

describe("the link of a pricing card", () => {
  it("writes ?tarif=…&obdobi=… and reads back the same choice", () => {
    expect(signupPlanSearch({ planKey: "pro", billing: "yearly" })).toBe("tarif=pro&obdobi=rok");
    expect(signupPlanSearch({ planKey: "team", billing: "monthly" })).toBe("tarif=team&obdobi=mesic");
    for (const choice of [
      { planKey: "solo", billing: "monthly" },
      { planKey: "pro", billing: "yearly" },
      { planKey: "team", billing: "yearly" },
    ] as const) {
      expect(parseSignupPlan(new URLSearchParams(signupPlanSearch(choice)))).toEqual(choice);
    }
  });

  it("goes to the registration in the page's language", () => {
    expect(registerHref("cs", { planKey: "pro", billing: "yearly" })).toBe("/registrace?tarif=pro&obdobi=rok");
    expect(registerHref("en", { planKey: "solo", billing: "monthly" })).toBe("/en/register?tarif=solo&obdobi=mesic");
    expect(registerHref("cs")).toBe("/registrace");
    expect(registerHref("en", null)).toBe("/en/register");
  });
});

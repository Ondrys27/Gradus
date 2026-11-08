import { describe, expect, it } from "vitest";
import {
  generatePromoCode,
  GENERATED_ALPHABET,
  isPromoCode,
  normalizePromoCode,
  partnerCommission,
  promoCodeFormSchema,
  promoCodeState,
  promoFormErrors,
  promoLink,
  type PromoCodeFormInput,
} from "./codes";

const valid: PromoCodeFormInput = {
  code: "jana-2026",
  partnerName: " Jana Partnerová ",
  partnerEmail: "Jana@Example.com",
  partnerNote: "",
  kind: "influencer",
  benefit: "percent_off_first",
  benefitValue: 50,
  commissionPercent: 20,
  maxUses: null,
  validFrom: "",
  validTo: "",
  active: true,
};

describe("normalizePromoCode", () => {
  it("makes capitals without diacritics, spaces, dashes or underscores", () => {
    expect(normalizePromoCode(" jana-2026 ")).toBe("JANA2026");
    expect(normalizePromoCode("škoda_léto")).toBe("SKODALETO");
    expect(normalizePromoCode("a b\tc")).toBe("ABC");
  });

  it("leaves other characters for the check to refuse", () => {
    expect(isPromoCode(normalizePromoCode("jan.novak"))).toBe(false);
    expect(isPromoCode(normalizePromoCode("ab"))).toBe(false);
    expect(isPromoCode("A".repeat(17))).toBe(false);
    expect(isPromoCode("ABCD")).toBe(true);
    expect(isPromoCode("A".repeat(16))).toBe(true);
  });
});

describe("generatePromoCode", () => {
  it("draws 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePromoCode();
      expect(code).toHaveLength(8);
      expect(isPromoCode(code)).toBe(true);
      expect([...code].every((char) => GENERATED_ALPHABET.includes(char))).toBe(true);
    }
  });

  it("skips bytes that would favour the start of the alphabet", () => {
    const bytes = [255, 254, 0, 1, 2, 3, 4, 5, 6, 7];
    const code = generatePromoCode((buffer) => {
      buffer.set(bytes.slice(0, buffer.length));
      return buffer;
    }, 4);
    expect(code).toBe("ABCD");
  });
});

describe("partnerCommission", () => {
  it("is the share of the payment without VAT, to the cent", () => {
    expect(partnerCommission(604.79, 104.96, 20)).toBe(99.97);
    expect(partnerCommission(1000, 0, 10)).toBe(100);
    expect(partnerCommission(499, 0, 12.5)).toBe(62.38);
    expect(partnerCommission(0.05, 0, 50)).toBe(0.03);
  });

  it("earns nothing without a payment or a percentage", () => {
    expect(partnerCommission(0, 0, 20)).toBe(0);
    expect(partnerCommission(100, 100, 20)).toBe(0);
    expect(partnerCommission(499, 0, 0)).toBe(0);
  });

  it("never exceeds the payment", () => {
    expect(partnerCommission(499, 0, 100)).toBe(499);
    expect(partnerCommission(499, 0, 150)).toBe(499);
  });
});

describe("promoCodeFormSchema", () => {
  it("normalizes the code, the partner's e-mail and empty texts", () => {
    const parsed = promoCodeFormSchema.parse(valid);
    expect(parsed).toMatchObject({
      code: "JANA2026",
      partnerName: "Jana Partnerová",
      partnerEmail: "jana@example.com",
      partnerNote: null,
    });
  });

  it("keeps each benefit in its range", () => {
    const check = (benefit: PromoCodeFormInput["benefit"], benefitValue: number) =>
      promoCodeFormSchema.safeParse({ ...valid, benefit, benefitValue }).success;
    expect(check("percent_off_first", 100)).toBe(true);
    expect(check("percent_off_first", 101)).toBe(false);
    expect(check("percent_off_first", 0)).toBe(false);
    expect(check("trial_days_extra", 90)).toBe(true);
    expect(check("trial_days_extra", 91)).toBe(false);
    expect(check("months_free", 12)).toBe(true);
    expect(check("months_free", 13)).toBe(false);
    expect(check("months_free", 1.5)).toBe(false);
  });

  it("names the fields that are wrong", () => {
    const result = promoCodeFormSchema.safeParse({
      ...valid,
      code: "ab",
      partnerName: " ",
      partnerEmail: "nope",
      commissionPercent: 100.5,
      maxUses: 0,
      validFrom: "2026-12-10",
      validTo: "2026-12-01",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(promoFormErrors(result.error).sort()).toEqual(
      ["code", "commission", "maxUses", "partnerEmail", "partnerName", "validTo"].sort(),
    );
  });

  it("allows a commission with two decimals, not three", () => {
    expect(promoCodeFormSchema.safeParse({ ...valid, commissionPercent: 12.25 }).success).toBe(
      true,
    );
    expect(promoCodeFormSchema.safeParse({ ...valid, commissionPercent: 12.345 }).success).toBe(
      false,
    );
    expect(promoCodeFormSchema.safeParse({ ...valid, commissionPercent: 0 }).success).toBe(true);
  });
});

describe("promoCodeState", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const base = { active: true, validFrom: null, validTo: null, maxUses: null };

  it("says why a code cannot be used now", () => {
    expect(promoCodeState(base, 3, now)).toBe("active");
    expect(promoCodeState({ ...base, active: false }, 0, now)).toBe("inactive");
    expect(promoCodeState({ ...base, validFrom: "2026-11-09T00:00:00Z" }, 0, now)).toBe(
      "scheduled",
    );
    expect(promoCodeState({ ...base, validTo: "2026-11-08T12:00:00Z" }, 0, now)).toBe("expired");
    expect(promoCodeState({ ...base, maxUses: 3 }, 3, now)).toBe("exhausted");
    expect(promoCodeState({ ...base, maxUses: 3 }, 2, now)).toBe("active");
  });
});

describe("promoLink", () => {
  it("points at the website with the code", () => {
    expect(promoLink("https://gradus.app/", "JANA2026")).toBe("https://gradus.app/?kod=JANA2026");
  });
});

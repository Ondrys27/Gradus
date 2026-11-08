import { describe, expect, it } from "vitest";
import {
  bestCodes,
  moneyMap,
  payoutsCsv,
  validFromDay,
  validFromInstant,
  validToDay,
  validToInstant,
  type PromoCodeStats,
} from "./promo-admin";

const TZ = "Europe/Prague";

describe("validity days", () => {
  it("covers whole days in the administration's zone", () => {
    expect(validFromInstant("2026-12-01", TZ)).toBe("2026-11-30T23:00:00.000Z");
    expect(validToInstant("2026-12-31", TZ)).toBe("2026-12-31T23:00:00.000Z");
    expect(validToInstant("2026-07-31", TZ)).toBe("2026-07-31T22:00:00.000Z");
    expect(validFromInstant("", TZ)).toBeNull();
    expect(validToInstant("", TZ)).toBeNull();
  });

  it("shows the same days again when editing", () => {
    expect(validFromDay(validFromInstant("2026-12-01", TZ), TZ)).toBe("2026-12-01");
    expect(validToDay(validToInstant("2026-12-31", TZ), TZ)).toBe("2026-12-31");
    expect(validToDay(validToInstant("2026-03-28", TZ), TZ)).toBe("2026-03-28");
    expect(validToDay(null, TZ)).toBe("");
  });
});

const stats = (
  id: string,
  redemptionsSince: number,
  payingSince: number,
): { id: string; stats: PromoCodeStats } => ({
  id,
  stats: {
    codeId: id,
    redemptions: 9,
    redemptionsSince,
    paying: 0,
    payingSince,
    due: {},
    paid: {},
  },
});

describe("bestCodes", () => {
  it("ranks the last 30 days by registrations, then paying, and leaves out idle codes", () => {
    const codes = [
      stats("a", 2, 0),
      stats("b", 5, 1),
      stats("c", 0, 0),
      stats("d", 2, 2),
      stats("e", 0, 1),
    ];
    expect(bestCodes(codes).map((code) => code.id)).toEqual(["b", "d", "a", "e"]);
    expect(bestCodes(codes, 2).map((code) => code.id)).toEqual(["b", "d"]);
  });
});

describe("moneyMap", () => {
  it("keeps positive amounts per currency only", () => {
    expect(moneyMap({ CZK: 99.97, EUR: "4.5", USD: 0, bad: 3 })).toEqual({ CZK: 99.97, EUR: 4.5 });
    expect(moneyMap(null)).toEqual({});
    expect(moneyMap([1])).toEqual({});
  });
});

describe("payoutsCsv", () => {
  it("lists each payout with the partner for the accountant", () => {
    const csv = payoutsCsv({ code: "JANA2026", partnerName: "Jana, s.r.o.", partnerEmail: null }, [
      {
        id: "p1",
        createdAt: "2026-11-08T10:00:00.000Z",
        status: "approved",
        baseAmount: 499.83,
        commissionPercent: 20,
        amount: 99.97,
        currency: "CZK",
        approvedAt: "2026-11-09T08:00:00.000Z",
        paidAt: null,
      },
    ]);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe(
      "payout_id,code,partner_name,partner_email,created_at,status,payment_without_vat,commission_percent,commission,currency,approved_at,paid_at",
    );
    expect(row).toBe(
      'p1,JANA2026,"Jana, s.r.o.",,2026-11-08T10:00:00.000Z,approved,499.83,20.00,99.97,CZK,2026-11-09T08:00:00.000Z,',
    );
  });
});

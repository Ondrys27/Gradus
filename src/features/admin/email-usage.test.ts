import { describe, expect, it } from "vitest";
import { emailForecast, parseEmailUsage, usageState } from "./email-usage";

describe("emailForecast", () => {
  it("projects the month at its pace so far and says the day the limit runs out", () => {
    // 1 500 in 10 days of a 30-day month: 150 a day, 3 000 reached on the 20th.
    expect(emailForecast({ today: 140, month: 1500 }, 10, 30, "free")).toEqual({
      monthlyLimit: 3000,
      dailyLimit: 100,
      projected: 4500,
      exhaustDay: 20,
      monthShare: 0.5,
      dayShare: 1.4,
    });
  });

  it("lasts the month at a calm pace, and has no daily limit on Pro", () => {
    const calm = emailForecast({ today: 20, month: 300 }, 15, 30, "pro");
    expect(calm.exhaustDay).toBeNull();
    expect(calm.dailyLimit).toBeNull();
    expect(calm.dayShare).toBeNull();
    expect(calm.projected).toBe(600);
  });

  it("is reached already, or nothing sent at all", () => {
    expect(emailForecast({ today: 0, month: 3200 }, 12, 31, "free").exhaustDay).toBe(12);
    expect(emailForecast({ today: 0, month: 0 }, 1, 31, "free")).toMatchObject({ projected: 0, exhaustDay: null });
  });
});

describe("usageState", () => {
  it("warns from 80 % and is red at the limit", () => {
    expect(usageState(0.79)).toBe("good");
    expect(usageState(0.8)).toBe("warn");
    expect(usageState(1)).toBe("bad");
    expect(usageState(null)).toBe("good");
  });
});

describe("parseEmailUsage", () => {
  it("reads the database's answer and drops what is not a count", () => {
    expect(
      parseEmailUsage({ today: 3, month: "40", failed_month: null, by_kind: { invoice: 12, chat: 0, x: "y" } }),
    ).toEqual({ today: 3, month: 40, failedMonth: 0, byKind: { invoice: 12 } });
    expect(parseEmailUsage(null)).toEqual({ today: 0, month: 0, failedMonth: 0, byKind: {} });
  });
});

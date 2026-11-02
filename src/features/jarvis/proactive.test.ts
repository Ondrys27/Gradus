import { describe, expect, it } from "vitest";
import {
  clientBlock,
  inQuietHours,
  nextAllowedAt,
  nextPeriodStart,
  NOTES_INTRO_SETTLE_MS,
  notesIntroDue,
  PAGE_SETTLE_MS,
  orderProactive,
  periodStartOf,
  pickProactive,
  previousPeriodStart,
  questionAllowed,
  serverBlock,
  snoozeUntil,
  speaksBetweenSummaries,
  summaryDue,
  summaryPeriodOf,
  toJarvisFrequency,
  type ProactiveCandidate,
  type ProactiveSettings,
} from "./proactive";

const HOUR = 3_600_000;
const settings: ProactiveSettings = {
  enabled: true,
  frequency: "every_2h",
  quietFrom: null,
  quietTo: null,
  timeZone: "Europe/Prague",
};

describe("quiet hours", () => {
  it("covers a range within a day and one across midnight, without its end hour", () => {
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(14, 12, 14)).toBe(false);
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(12, 22, 7)).toBe(false);
    expect(inQuietHours(3, null, null)).toBe(false);
  });
});

describe("serverBlock", () => {
  const now = new Date("2026-10-03T10:00:00Z"); // 12:00 in Prague

  it("keeps 2 hours between appearances with Often, 6 with Now and then", () => {
    const oneHourAgo = new Date(now.getTime() - HOUR).toISOString();
    const threeHoursAgo = new Date(now.getTime() - 3 * HOUR).toISOString();
    expect(serverBlock({ now, settings, lastShownAt: oneHourAgo })).toBe("tooSoon");
    expect(serverBlock({ now, settings, lastShownAt: threeHoursAgo })).toBeNull();
    expect(
      serverBlock({ now, settings: { ...settings, frequency: "every_6h" }, lastShownAt: threeHoursAgo }),
    ).toBe("tooSoon");
    expect(nextAllowedAt(threeHoursAgo, "every_6h")).toBe(now.getTime() + 3 * HOUR);
    expect(serverBlock({ now, settings, lastShownAt: null })).toBeNull();
  });

  it("brings up nothing between the summaries once a day, week or month", () => {
    for (const frequency of ["daily", "weekly", "monthly"] as const) {
      expect(speaksBetweenSummaries(frequency)).toBe(false);
      expect(serverBlock({ now, settings: { ...settings, frequency }, lastShownAt: null })).toBe(
        "summaryOnly",
      );
    }
    expect(speaksBetweenSummaries("every_2h")).toBe(true);
    expect(speaksBetweenSummaries("every_6h")).toBe(true);
  });

  it("respects the switch and quiet hours in the user's zone", () => {
    expect(serverBlock({ now, settings: { ...settings, enabled: false }, lastShownAt: null })).toBe(
      "disabled",
    );
    // 12:00 in Prague is inside 11–13 there, but not in UTC terms (10:00).
    expect(
      serverBlock({ now, settings: { ...settings, quietFrom: 11, quietTo: 13 }, lastShownAt: null }),
    ).toBe("quiet");
    expect(
      serverBlock({
        now,
        settings: { ...settings, quietFrom: 9, quietTo: 11 },
        lastShownAt: null,
      }),
    ).toBeNull();
  });
});

describe("clientBlock", () => {
  const base = {
    now: 1_000_000,
    pageSince: 1_000_000 - PAGE_SETTLE_MS,
    shownThisSession: false,
    timerRunning: false,
    dialogOpen: false,
    busy: false,
    visible: true,
  };

  it("lets Jarvis in only on a settled page with nothing else going on", () => {
    expect(clientBlock(base)).toBeNull();
    expect(clientBlock({ ...base, pageSince: base.now - PAGE_SETTLE_MS + 1 })).toBe("settling");
    expect(clientBlock({ ...base, timerRunning: true })).toBe("timer");
    expect(clientBlock({ ...base, dialogOpen: true })).toBe("dialog");
    expect(clientBlock({ ...base, busy: true })).toBe("busy");
    expect(clientBlock({ ...base, visible: false })).toBe("hidden");
  });

  it("never twice in one session", () => {
    expect(clientBlock({ ...base, shownThisSession: true })).toBe("session");
  });

  it("can settle for a shorter time when a caller asks for it", () => {
    const calm = { ...base, pageSince: base.now - NOTES_INTRO_SETTLE_MS, settleMs: NOTES_INTRO_SETTLE_MS };
    expect(clientBlock(calm)).toBeNull();
    expect(clientBlock({ ...calm, pageSince: base.now - 1_000 })).toBe("settling");
    expect(clientBlock({ ...calm, dialogOpen: true })).toBe("dialog");
  });
});

describe("notesIntroDue", () => {
  const done = "2026-10-17T08:00:00Z";
  const base = {
    worker: false,
    onboardingCompletedAt: done,
    tourCompletedAt: done,
    notesIntroSeenAt: null,
  };

  it("comes once, after the onboarding and the tour, in the account's own space", () => {
    expect(notesIntroDue(base)).toBe(true);
    expect(notesIntroDue({ ...base, notesIntroSeenAt: done })).toBe(false);
    expect(notesIntroDue({ ...base, tourCompletedAt: null })).toBe(false);
    expect(notesIntroDue({ ...base, onboardingCompletedAt: null })).toBe(false);
    expect(notesIntroDue({ ...base, worker: true })).toBe(false);
  });
});

describe("pickProactive", () => {
  const item = (kind: ProactiveCandidate["kind"], createdAt: string) => ({
    kind,
    createdAt,
    id: `${kind}-${createdAt}`,
  });
  const candidates = [
    item("question", "2026-10-03T09:00:00Z"),
    item("suggestion", "2026-10-02T09:00:00Z"),
    item("suggestion", "2026-10-03T08:00:00Z"),
    item("briefing", "2026-10-03T04:00:00Z"),
  ];

  it("puts the newest suggestion first, then a question, and never the brief", () => {
    const options = { frequency: "every_2h" as const };
    expect(pickProactive(candidates, options)?.id).toBe("suggestion-2026-10-03T08:00:00Z");
    expect(pickProactive([candidates[0]!], options)?.kind).toBe("question");
    // The brief is the summary's at the first arrival.
    expect(pickProactive([candidates[3]!], options)).toBeNull();
  });

  it("has nothing to say without candidates or with a summary-only frequency", () => {
    expect(pickProactive([], { frequency: "every_2h" })).toBeNull();
    expect(pickProactive(candidates, { frequency: "daily" })).toBeNull();
  });
});

describe("orderProactive", () => {
  const options = { frequency: "every_2h" as const };
  const item = (id: string, kind: ProactiveCandidate["kind"], type: string, createdAt: string) => ({
    id,
    kind,
    type,
    createdAt,
  });

  it("puts suggestions by urgency and age first, then questions", () => {
    const ordered = orderProactive(
      [
        item("question", "question", "question", "2026-10-03T09:30:00Z"),
        item("insight", "suggestion", "insight", "2026-10-03T09:00:00Z"),
        item("stalled", "suggestion", "stalledDeal", "2026-10-01T09:00:00Z"),
        item("overdue-old", "suggestion", "overdueTask", "2026-10-01T08:00:00Z"),
        item("overdue-new", "suggestion", "overdueTask", "2026-10-02T08:00:00Z"),
        item("brief", "briefing", "briefing", "2026-10-03T04:00:00Z"),
      ],
      options,
    );
    expect(ordered.map((entry) => entry.id)).toEqual([
      "overdue-new",
      "overdue-old",
      "stalled",
      "insight",
      "question",
    ]);
  });

  it("leaves everything out when the frequency is a summary only", () => {
    const list = [item("insight", "suggestion", "insight", "2026-10-03T09:00:00Z")];
    for (const frequency of ["daily", "weekly", "monthly"] as const) {
      expect(orderProactive(list, { frequency })).toEqual([]);
    }
  });
});

describe("frequencies", () => {
  it("reads the old values as the new ones and anything unknown as Now and then", () => {
    expect(toJarvisFrequency("often")).toBe("every_2h");
    expect(toJarvisFrequency("sometimes")).toBe("every_6h");
    expect(toJarvisFrequency("briefing_only")).toBe("daily");
    expect(toJarvisFrequency("weekly")).toBe("weekly");
    expect(toJarvisFrequency("always")).toBe("every_6h");
    expect(toJarvisFrequency(null)).toBe("every_6h");
  });

  it("gives a summary of the day to every frequency but weekly and monthly", () => {
    expect(summaryPeriodOf("every_2h")).toBe("day");
    expect(summaryPeriodOf("every_6h")).toBe("day");
    expect(summaryPeriodOf("daily")).toBe("day");
    expect(summaryPeriodOf("weekly")).toBe("week");
    expect(summaryPeriodOf("monthly")).toBe("month");
  });
});

describe("summary periods", () => {
  it("starts a week on the user's first day of the week", () => {
    // 2026-11-04 is a Wednesday.
    expect(periodStartOf("2026-11-04", "week", 1)).toBe("2026-11-02");
    expect(periodStartOf("2026-11-04", "week", 0)).toBe("2026-11-01");
    expect(periodStartOf("2026-11-04", "week", 6)).toBe("2026-10-31");
    expect(periodStartOf("2026-11-02", "week", 1)).toBe("2026-11-02");
    expect(periodStartOf("2026-11-04", "month", 1)).toBe("2026-11-01");
    expect(periodStartOf("2026-11-04", "day", 1)).toBe("2026-11-04");
  });

  it("knows the period before and after, across months and years", () => {
    expect(previousPeriodStart("2026-11-02", "week")).toBe("2026-10-26");
    expect(previousPeriodStart("2026-01-01", "month")).toBe("2025-12-01");
    expect(previousPeriodStart("2026-03-01", "day")).toBe("2026-02-28");
    expect(nextPeriodStart("2026-12-28", "week")).toBe("2027-01-04");
    expect(nextPeriodStart("2026-01-01", "month")).toBe("2026-02-01");
    expect(nextPeriodStart("2026-02-01", "month")).toBe("2026-03-01");
    expect(nextPeriodStart("2026-12-01", "month")).toBe("2027-01-01");
  });
});

describe("summaryDue: the first arrival of the day", () => {
  const base = {
    timeZone: "Europe/Prague",
    weekStartsOn: 1,
    frequency: "daily" as const,
    enabled: true,
    onboardingCompletedAt: "2026-10-20T08:00:00Z",
    lastSummaryOn: null,
  };

  it("is due at the first arrival of a day and not again that day", () => {
    const now = new Date("2026-11-02T07:00:00Z"); // 8:00 in Prague
    expect(summaryDue({ ...base, now })).toEqual({
      period: "day",
      today: "2026-11-02",
      start: "2026-11-02",
    });
    expect(summaryDue({ ...base, now, lastSummaryOn: "2026-11-02" })).toBeNull();
    expect(summaryDue({ ...base, now, lastSummaryOn: "2026-11-01" })?.today).toBe("2026-11-02");
  });

  it("counts the day in the user's zone, not in UTC", () => {
    // 23:30 UTC on 1 November: still the 1st in New York, already the 2nd in Prague and Tokyo.
    const now = new Date("2026-11-01T23:30:00Z");
    const seen = { lastSummaryOn: "2026-11-01" };
    expect(summaryDue({ ...base, ...seen, now, timeZone: "Europe/Prague" })?.today).toBe(
      "2026-11-02",
    );
    expect(summaryDue({ ...base, ...seen, now, timeZone: "Asia/Tokyo" })?.today).toBe("2026-11-02");
    expect(summaryDue({ ...base, ...seen, now, timeZone: "America/New_York" })).toBeNull();
  });

  it("comes again right after midnight, not a minute before", () => {
    const seen = { lastSummaryOn: "2026-11-02" };
    // Prague is UTC+1 in November: midnight of the 3rd is 23:00 UTC on the 2nd.
    expect(summaryDue({ ...base, ...seen, now: new Date("2026-11-02T22:59:00Z") })).toBeNull();
    expect(summaryDue({ ...base, ...seen, now: new Date("2026-11-02T23:01:00Z") })?.today).toBe(
      "2026-11-03",
    );
  });

  it("waits until the day after the onboarding, in the user's zone", () => {
    // Onboarding at 23:30 in Prague on the 1st (22:30 UTC); the 2nd is the next day there.
    const onboarded = { onboardingCompletedAt: "2026-11-01T22:30:00Z" };
    expect(summaryDue({ ...base, ...onboarded, now: new Date("2026-11-01T22:50:00Z") })).toBeNull();
    expect(summaryDue({ ...base, ...onboarded, now: new Date("2026-11-01T23:10:00Z") })?.today).toBe(
      "2026-11-02",
    );
    expect(summaryDue({ ...base, onboardingCompletedAt: null, now: new Date() })).toBeNull();
  });

  it("says nothing when Jarvis is switched off", () => {
    expect(summaryDue({ ...base, enabled: false, now: new Date("2026-11-02T07:00:00Z") })).toBeNull();
  });

  it("gives a weekly summary once a week, from the first day of the week", () => {
    const weekly = { ...base, frequency: "weekly" as const };
    // Monday 2 November.
    expect(
      summaryDue({ ...weekly, lastSummaryOn: "2026-10-26", now: new Date("2026-11-02T07:00:00Z") }),
    ).toEqual({ period: "week", today: "2026-11-02", start: "2026-11-02" });
    // Shown on Monday: nothing on Wednesday.
    expect(
      summaryDue({ ...weekly, lastSummaryOn: "2026-11-02", now: new Date("2026-11-04T07:00:00Z") }),
    ).toBeNull();
    // A week that starts on Sunday has already begun on the 1st.
    expect(
      summaryDue({
        ...weekly,
        weekStartsOn: 0,
        lastSummaryOn: "2026-11-01",
        now: new Date("2026-11-02T07:00:00Z"),
      }),
    ).toBeNull();
    // Away on Monday: the week's summary comes at the first arrival of the week.
    expect(
      summaryDue({ ...weekly, lastSummaryOn: "2026-10-26", now: new Date("2026-11-04T07:00:00Z") })
        ?.start,
    ).toBe("2026-11-02");
  });

  it("gives a monthly summary at the first arrival of the month", () => {
    const monthly = { ...base, frequency: "monthly" as const };
    expect(
      summaryDue({ ...monthly, lastSummaryOn: "2026-10-01", now: new Date("2026-11-02T07:00:00Z") }),
    ).toEqual({ period: "month", today: "2026-11-02", start: "2026-11-01" });
    expect(
      summaryDue({ ...monthly, lastSummaryOn: "2026-11-02", now: new Date("2026-11-30T07:00:00Z") }),
    ).toBeNull();
    // 23:30 UTC on 30 November is already 1 December in Prague.
    expect(
      summaryDue({ ...monthly, lastSummaryOn: "2026-11-02", now: new Date("2026-11-30T23:30:00Z") })
        ?.start,
    ).toBe("2026-12-01");
  });
});

describe("snoozeUntil and questions", () => {
  it("postpones to the start of the user's next day", () => {
    // 23:30 in Prague on 3 October → midnight of 4 October in Prague (22:00 UTC).
    expect(snoozeUntil(new Date("2026-10-03T21:30:00Z"), "Europe/Prague").toISOString()).toBe(
      "2026-10-03T22:00:00.000Z",
    );
    expect(snoozeUntil(new Date("2026-10-03T21:30:00Z"), "America/New_York").toISOString()).toBe(
      "2026-10-04T04:00:00.000Z",
    );
  });

  it("asks at most two questions a week", () => {
    expect(questionAllowed(0)).toBe(true);
    expect(questionAllowed(1)).toBe(true);
    expect(questionAllowed(2)).toBe(false);
  });
});

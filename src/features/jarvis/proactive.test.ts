import { describe, expect, it } from "vitest";
import {
  clientBlock,
  inQuietHours,
  nextAllowedAt,
  NOTES_INTRO_SETTLE_MS,
  notesIntroDue,
  PAGE_SETTLE_MS,
  orderProactive,
  pickProactive,
  questionAllowed,
  serverBlock,
  snoozeUntil,
  type ProactiveCandidate,
  type ProactiveSettings,
} from "./proactive";

const HOUR = 3_600_000;
const settings: ProactiveSettings = {
  enabled: true,
  frequency: "often",
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

  it("keeps at least 4 hours between appearances, 12 when it is only now and then", () => {
    const threeHoursAgo = new Date(now.getTime() - 3 * HOUR).toISOString();
    const fiveHoursAgo = new Date(now.getTime() - 5 * HOUR).toISOString();
    expect(serverBlock({ now, settings, lastShownAt: threeHoursAgo })).toBe("tooSoon");
    expect(serverBlock({ now, settings, lastShownAt: fiveHoursAgo })).toBeNull();
    expect(
      serverBlock({ now, settings: { ...settings, frequency: "sometimes" }, lastShownAt: fiveHoursAgo }),
    ).toBe("tooSoon");
    expect(nextAllowedAt(threeHoursAgo, "briefing_only")).toBe(now.getTime() + HOUR);
    expect(serverBlock({ now, settings, lastShownAt: null })).toBeNull();
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
  const item = (
    kind: ProactiveCandidate["kind"],
    createdAt: string,
    briefingDate: string | null = null,
  ) => ({ kind, createdAt, briefingDate, id: `${kind}-${createdAt}` });
  const today = "2026-10-03";
  const candidates = [
    item("question", "2026-10-03T09:00:00Z"),
    item("suggestion", "2026-10-02T09:00:00Z"),
    item("suggestion", "2026-10-03T08:00:00Z"),
    item("briefing", "2026-10-03T04:00:00Z", today),
    item("briefing", "2026-10-02T04:00:00Z", "2026-10-02"),
  ];

  it("puts today's brief first, then the newest suggestion, then a question", () => {
    const options = { frequency: "often" as const, today, briefingUnlocked: true };
    expect(pickProactive(candidates, options)?.id).toBe("briefing-2026-10-03T04:00:00Z");
    expect(pickProactive(candidates, { ...options, briefingUnlocked: false })?.id).toBe(
      "suggestion-2026-10-03T08:00:00Z",
    );
    expect(pickProactive([candidates[0]!], options)?.kind).toBe("question");
  });

  it("shows only the brief with 'brief only', and never yesterday's", () => {
    const options = { frequency: "briefing_only" as const, today, briefingUnlocked: true };
    expect(pickProactive(candidates, options)?.kind).toBe("briefing");
    expect(pickProactive(candidates.slice(0, 3), options)).toBeNull();
    expect(pickProactive([candidates[4]!], { ...options, frequency: "often" })).toBeNull();
  });

  it("has nothing to say without candidates", () => {
    expect(pickProactive([], { frequency: "often", today, briefingUnlocked: true })).toBeNull();
  });
});

describe("orderProactive", () => {
  const today = "2026-10-03";
  const options = { frequency: "often" as const, today, briefingUnlocked: true };
  const item = (id: string, kind: ProactiveCandidate["kind"], type: string, createdAt: string) => ({
    id,
    kind,
    type,
    createdAt,
    briefingDate: kind === "briefing" ? today : null,
  });

  it("puts the brief first, then suggestions by urgency and age, then questions", () => {
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
      "brief",
      "overdue-new",
      "overdue-old",
      "stalled",
      "insight",
      "question",
    ]);
  });

  it("leaves out what the frequency or the account does not allow", () => {
    const list = [
      item("brief", "briefing", "briefing", "2026-10-03T04:00:00Z"),
      item("insight", "suggestion", "insight", "2026-10-03T09:00:00Z"),
    ];
    expect(orderProactive(list, { ...options, frequency: "briefing_only" }).map((e) => e.id)).toEqual(
      ["brief"],
    );
    expect(orderProactive(list, { ...options, briefingUnlocked: false }).map((e) => e.id)).toEqual([
      "insight",
    ]);
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

import { beforeEach, describe, expect, it } from "vitest";
import { changedLocally, conflictWinner, flushOutbox, pullCalendar } from "./engine";
import { createGoogleProvider, type GoogleProvider } from "./providers/google";
import { MemoryStore } from "./testing/memory-store";
import { createMockGoogle, type MockGoogle } from "./testing/mock-google";

// Two-way sync (28.10) against a mock Google: incremental reads with a
// syncToken, our own writes coming back, conflicts both ways (the newer
// change wins), series and one changed instance, a forgotten token, a new
// Gradus event and a booked meeting with Meet, deletes, and disconnect.

const CAL = "me@example.com";
const ZONE = "Europe/Prague";
const T0 = Date.parse("2026-12-01T08:00:00Z");
const MINUTE = 60_000;

let now = T0;
let google: MockGoogle;
let provider: GoogleProvider;
let store: MemoryStore;
const calendar = () => store.calendars.get("cal-1")!;

function tick(minutes = 1) {
  now += minutes * MINUTE;
  google.setClock(now);
}

beforeEach(() => {
  now = T0;
  google = createMockGoogle(now);
  provider = createGoogleProvider({
    tokens: { accessToken: "at", refreshToken: "rt", expiresAt: T0 + 3_600_000 * 24 * 365 },
    client: { clientId: "id", clientSecret: "secret" },
    fetcher: google.fetcher,
    timeZone: ZONE,
    now: () => now,
  });
  store = new MemoryStore("user-1", () => now);
  store.addCalendar({ id: "cal-1", connectionId: "conn-1", externalId: CAL, syncState: null, canWrite: true, write: true });
});

const pull = () => pullCalendar(provider, store, calendar(), now);
const flush = () => flushOutbox("user-1", store, async () => provider, ZONE);

function timed(id: string, title: string, startIso: string, extra: Record<string, unknown> = {}) {
  const start = Date.parse(startIso);
  return google.upsert(CAL, {
    id,
    summary: title,
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(start + 3_600_000).toISOString() },
    ...extra,
  });
}

describe("reading from Google", () => {
  it("reads everything first, then only what changed (syncToken)", async () => {
    timed("a", "Call Anna", "2026-12-02T09:00:00Z");
    timed("b", "Demo", "2026-12-03T09:00:00Z");
    const first = await pull();
    expect(first.full).toBe(true);
    expect(store.eventRows.size).toBe(2);
    const firstList = google.requests.find((request) => request.url.pathname.endsWith("/events"))!;
    expect(firstList.url.searchParams.get("timeMin")).not.toBeNull();
    expect(firstList.url.searchParams.get("singleEvents")).toBe("true");
    expect(store.states.get("cal-1")).toMatch(/^tok:/);

    tick();
    timed("a", "Call Anna (moved)", "2026-12-02T10:00:00Z");
    google.remove(CAL, "b");
    timed("c", "Lunch", "2026-12-04T11:00:00Z");
    google.requests.length = 0;
    const second = await pull();
    const list = google.requests.find((request) => request.url.pathname.endsWith("/events"))!;
    expect(list.url.searchParams.get("syncToken")).toMatch(/^tok:/);
    expect(list.url.searchParams.get("timeMin")).toBeNull();
    expect(second.full).toBe(false);
    expect(store.byExternal("a")?.title).toBe("Call Anna (moved)");
    expect(store.byExternal("a")?.starts_at).toBe("2026-12-02T10:00:00.000Z");
    expect(store.byExternal("b")).toBeUndefined();
    expect(store.byExternal("c")?.source).toBe("external");
    // Nothing read in goes back out.
    expect(store.outbox).toEqual([]);
  });

  it("maps an all-day event to the person's days (end exclusive at Google)", async () => {
    google.upsert(CAL, { id: "d", summary: "Holiday", start: { date: "2026-12-24" }, end: { date: "2026-12-27" } });
    await pull();
    const event = store.byExternal("d")!;
    expect(event.all_day).toBe(true);
    expect(event.starts_at).toBe("2026-12-23T23:00:00.000Z");
    // The last day (26th) at midnight in Prague.
    expect(event.ends_at).toBe("2026-12-25T23:00:00.000Z");
  });

  it("keeps an event marked free as free", async () => {
    timed("f", "Maybe", "2026-12-02T09:00:00Z", { transparency: "transparent" });
    await pull();
    const event = store.byExternal("f")!;
    expect(store.linkRows.get(event.id)?.transparent).toBe(true);
  });

  it("reads everything again when Google forgot the token (410) and drops what is gone", async () => {
    timed("a", "One", "2026-12-02T09:00:00Z");
    timed("b", "Two", "2026-12-03T09:00:00Z");
    await pull();
    tick();
    google.remove(CAL, "b");
    google.forgetTokensBefore(Number.MAX_SAFE_INTEGER);
    const result = await pull();
    expect(result.full).toBe(true);
    expect(store.byExternal("a")).toBeDefined();
    expect(store.byExternal("b")).toBeUndefined();
  });
});

describe("series", () => {
  it("reads instances, writes one changed instance by its own id, removes a deleted series", async () => {
    for (const [index, day] of ["2026-12-07", "2026-12-14", "2026-12-21"].entries()) {
      timed(`weekly_${day.replaceAll("-", "")}`, "Weekly", `${day}T08:00:00Z`, { recurringEventId: "weekly" });
      void index;
    }
    await pull();
    expect(store.eventRows.size).toBe(3);

    tick();
    const second = store.byExternal("weekly_20261214")!;
    store.editLocal(second.id, { title: "Weekly (moved)", starts_at: "2026-12-14T09:00:00.000Z", ends_at: "2026-12-14T10:00:00.000Z" });
    await flush();
    const patch = google.requests.find((request) => request.method === "PATCH")!;
    expect(decodeURIComponent(patch.url.pathname)).toMatch(/\/events\/weekly_20261214$/);
    expect(google.get(CAL, "weekly_20261214")?.summary).toBe("Weekly (moved)");
    expect(google.get(CAL, "weekly_20261207")?.summary).toBe("Weekly");

    tick();
    // Google tells a deleted series by its id.
    google.remove(CAL, "weekly");
    await pull();
    expect(store.eventRows.size).toBe(0);
  });
});

describe("writing to Google", () => {
  it("a new Gradus event goes to the calendar written to; it does not come back as a change", async () => {
    const event = store.createLocal({ title: "Coffee", starts_at: "2026-12-05T09:00:00.000Z", ends_at: "2026-12-05T09:30:00.000Z" });
    const result = await flush();
    expect(result.sent).toBe(1);
    const post = google.requests.find((request) => request.method === "POST")!;
    expect(post.body).toMatchObject({ summary: "Coffee", start: { dateTime: "2026-12-05T09:00:00.000Z", timeZone: ZONE } });
    expect(post.url.searchParams.get("sendUpdates")).toBe("none");
    const link = store.linkRows.get(event.id)!;
    expect(link.origin).toBe("gradus");

    const before = store.eventRows.get(event.id)!.updated_at;
    tick();
    await pull();
    expect(store.eventRows.get(event.id)!.updated_at).toBe(before);
    expect(store.outbox).toEqual([]);
  });

  it("a booked meeting invites the guest and asks for Google Meet once", async () => {
    const event = store.createLocal({ title: "Intro call", starts_at: "2026-12-05T09:00:00.000Z", ends_at: "2026-12-05T09:30:00.000Z" }, "booking");
    store.bookings.set("b1", { id: "b1", eventId: event.id, guestEmail: "guest@example.com", guestName: "Guest", wantsMeet: true, meetLink: null });
    await flush();
    const post = google.requests.find((request) => request.method === "POST")!;
    expect(post.body).toMatchObject({
      attendees: [{ email: "guest@example.com", displayName: "Guest" }],
      conferenceData: { createRequest: { requestId: "gradus-b1", conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
    expect(post.url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(store.bookings.get("b1")?.meetLink).toMatch(/^https:\/\/meet\.google\.com\//);

    tick();
    store.editLocal(event.id, { starts_at: "2026-12-05T10:00:00.000Z", ends_at: "2026-12-05T10:30:00.000Z" });
    await flush();
    const patch = google.requests.find((request) => request.method === "PATCH")!;
    expect((patch.body as Record<string, unknown>).conferenceData).toBeUndefined();
  });

  it("deleting in Gradus deletes in Google", async () => {
    timed("a", "Call", "2026-12-02T09:00:00Z");
    await pull();
    store.deleteLocal(store.byExternal("a")!.id);
    await flush();
    expect(google.get(CAL, "a")?.status).toBe("cancelled");
  });

  it("an event edited in Gradus is written back to Google", async () => {
    timed("a", "Call", "2026-12-02T09:00:00Z");
    await pull();
    tick();
    store.editLocal(store.byExternal("a")!.id, { title: "Call Anna" });
    await flush();
    expect(google.get(CAL, "a")?.summary).toBe("Call Anna");
    const patch = google.requests.find((request) => request.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBeTruthy();
  });
});

describe("conflicts: the newer change wins", () => {
  beforeEach(async () => {
    timed("a", "Original", "2026-12-02T09:00:00Z");
    await pull();
  });

  it("Google newer: Gradus is overwritten, nothing goes out, the link remembers", async () => {
    const id = store.byExternal("a")!.id;
    tick();
    store.editLocal(id, { title: "Gradus edit" });
    tick();
    timed("a", "Google edit", "2026-12-02T09:00:00Z");
    const result = await pull();
    expect(result.conflicts).toBe(1);
    expect(store.eventRows.get(id)?.title).toBe("Google edit");
    expect(store.outbox).toEqual([]);
    expect(store.linkRows.get(id)?.conflictWinner).toBe("external");
  });

  it("Gradus newer: the read keeps Gradus and the waiting change overwrites Google", async () => {
    const id = store.byExternal("a")!.id;
    tick();
    timed("a", "Google edit", "2026-12-02T09:00:00Z");
    tick();
    store.editLocal(id, { title: "Gradus edit" });
    const result = await pull();
    expect(result.conflicts).toBe(1);
    expect(store.eventRows.get(id)?.title).toBe("Gradus edit");
    await flush();
    expect(google.get(CAL, "a")?.summary).toBe("Gradus edit");
    expect(store.linkRows.get(id)?.conflictWinner).toBe("gradus");
  });

  it("a write that meets a newer change in Google (412) takes Google's", async () => {
    const id = store.byExternal("a")!.id;
    tick();
    store.editLocal(id, { title: "Gradus edit" });
    tick();
    timed("a", "Google edit", "2026-12-02T09:00:00Z");
    const result = await flush();
    expect(result.conflicts).toBe(1);
    expect(store.eventRows.get(id)?.title).toBe("Google edit");
    expect(google.get(CAL, "a")?.summary).toBe("Google edit");
  });

  it("decides by time; a change without a time loses", () => {
    expect(conflictWinner("2026-12-01T10:00:00Z", "2026-12-01T10:01:00Z")).toBe("external");
    expect(conflictWinner("2026-12-01T10:02:00Z", "2026-12-01T10:01:00Z")).toBe("gradus");
    expect(conflictWinner("2026-12-01T10:02:00Z", null)).toBe("gradus");
    expect(changedLocally({ updated_at: "2026-12-01T10:02:00Z" }, { syncedAt: "2026-12-01T10:01:00Z" })).toBe(true);
    expect(changedLocally({ updated_at: "2026-12-01T10:01:00Z" }, { syncedAt: "2026-12-01T10:01:00Z" })).toBe(false);
  });
});

describe("disconnect", () => {
  it("events read in leave, Gradus's own stay and stop syncing", async () => {
    timed("a", "From Google", "2026-12-02T09:00:00Z");
    await pull();
    const own = store.createLocal({ title: "Mine", starts_at: "2026-12-05T09:00:00.000Z", ends_at: "2026-12-05T10:00:00.000Z" });
    await flush();
    store.forget("conn-1");
    store.calendars.clear();
    expect(store.byExternal("a")).toBeUndefined();
    expect(store.eventRows.get(own.id)?.title).toBe("Mine");
    expect(store.linkRows.size).toBe(0);
    // Nothing left to send anywhere.
    store.editLocal(own.id, { title: "Mine again" });
    expect(store.outbox).toEqual([]);
    // Google keeps its events.
    expect(google.get(CAL, "a")?.status).toBe("confirmed");
  });
});

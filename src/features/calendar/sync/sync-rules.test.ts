import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/features/errors/alerts/server/capture", () => ({ captureServerError: () => undefined }));

const { decideGate } = await import("./server/gate");
const { codeChallenge, decodeOAuthState, encodeOAuthState, newOAuthState, oauthStateMatches } = await import(
  "./server/oauth-state"
);
const { normalizeSelection, providerCardState } = await import("./overview");
const { allDayDays, allDayInstants } = await import("./types");

// The door to two-way sync (28.10): an account outside the allowlist never
// gets in, also by a direct call; a missing key or Google client is
// "unavailable"; the OAuth round trip belongs to the account that started it.

const configured = { key: true, google: true, apple: true };

describe("the gate", () => {
  it("refuses an account outside the allowlist whatever else is right", () => {
    expect(decideGate({ userId: "u", allowed: false, configuration: configured, provider: "google" })).toEqual({
      ok: false,
      error: "notAllowed",
    });
    expect(decideGate({ userId: "u", allowed: false, configuration: configured, provider: null })).toMatchObject({
      error: "notAllowed",
    });
  });

  it("needs a session, then the key, then Google's client for Google", () => {
    expect(decideGate({ userId: null, allowed: true, configuration: configured, provider: "google" })).toMatchObject({
      error: "unauthenticated",
    });
    expect(
      decideGate({ userId: "u", allowed: true, configuration: { key: false, google: false, apple: false }, provider: "apple" }),
    ).toEqual({ ok: false, error: "unavailable", missing: "key" });
    expect(
      decideGate({ userId: "u", allowed: true, configuration: { key: true, google: false, apple: true }, provider: "google" }),
    ).toEqual({ ok: false, error: "unavailable", missing: "google" });
    expect(
      decideGate({ userId: "u", allowed: true, configuration: { key: true, google: false, apple: true }, provider: "apple" }),
    ).toEqual({ ok: true });
  });
});

describe("the OAuth round trip", () => {
  it("matches only the same state from the same account within ten minutes", () => {
    const state = newOAuthState("user-1", 1_000_000);
    const decoded = decodeOAuthState(encodeOAuthState(state));
    expect(decoded).toEqual(state);
    expect(oauthStateMatches(decoded, { state: state.state, userId: "user-1" }, 1_000_000 + 60_000)).toBe(true);
    expect(oauthStateMatches(decoded, { state: state.state, userId: "user-2" }, 1_000_000)).toBe(false);
    expect(oauthStateMatches(decoded, { state: "other", userId: "user-1" }, 1_000_000)).toBe(false);
    expect(oauthStateMatches(decoded, { state: state.state, userId: "user-1" }, 1_000_000 + 11 * 60_000)).toBe(false);
    expect(decodeOAuthState("garbage")).toBeNull();
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("Settings", () => {
  const calendars = [
    { id: "a", canWrite: true },
    { id: "b", canWrite: false },
  ];

  it("the calendar written to is read too and must allow writing", () => {
    expect(normalizeSelection(calendars, [], "a")).toEqual({ read: ["a"], write: "a" });
    expect(normalizeSelection(calendars, ["b"], "b")).toEqual({ read: ["b"], write: null });
    expect(normalizeSelection(calendars, ["zzz"], null)).toEqual({ read: [], write: null });
  });

  it("shows 'coming soon' outside the allowlist, 'unavailable' without the key", () => {
    const base = { allowed: true, available: true, google: true, connections: [] };
    expect(providerCardState({ ...base, allowed: false }, "google")).toBe("notAllowed");
    expect(providerCardState({ ...base, available: false }, "apple")).toBe("unavailable");
    expect(providerCardState({ ...base, google: false }, "google")).toBe("unavailable");
    expect(providerCardState(base, "google")).toBe("connect");
    expect(
      providerCardState(
        { ...base, connections: [{ id: "c", provider: "apple", accountLabel: null, status: "error", lastError: "auth", lastSyncedAt: null, calendars: [] }] },
        "apple",
      ),
    ).toBe("broken");
  });
});

describe("all-day days", () => {
  it("round-trips Gradus's convention and an exclusive end day", () => {
    const one = allDayInstants("2026-12-24", "2026-12-25", "Europe/Prague");
    expect(one).toEqual({ startsAt: "2026-12-23T23:00:00.000Z", endsAt: null });
    expect(allDayDays(one.startsAt, one.endsAt, "Europe/Prague")).toEqual({ start: "2026-12-24", endExclusive: "2026-12-25" });
    const three = allDayInstants("2026-03-28", "2026-03-31", "Europe/Prague");
    expect(allDayDays(three.startsAt, three.endsAt, "Europe/Prague")).toEqual({ start: "2026-03-28", endExclusive: "2026-03-31" });
  });
});

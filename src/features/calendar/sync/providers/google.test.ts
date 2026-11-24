import { describe, expect, it } from "vitest";
import { createMockGoogle } from "../testing/mock-google";
import { ProviderError } from "../types";
import {
  createGoogleProvider,
  exchangeGoogleCode,
  fromGoogle,
  GOOGLE_SCOPES,
  googleAuthUrl,
  meetLinkOf,
  toGoogle,
} from "./google";

// Google's provider (28.10): only the two scopes, offline access with PKCE,
// every scope granted or no connection, shapes both ways, refreshing tokens.

describe("consent", () => {
  it("asks only for events and the calendar list, offline, with PKCE", () => {
    const url = new URL(
      googleAuthUrl({ clientId: "cid", redirectUri: "https://gradusgo.com/api/integrations/google/callback", state: "s", codeChallenge: "c" }),
    );
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("s");
  });

  it("refuses tokens without every scope or without a refresh token", async () => {
    const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
    const client = { clientId: "id", clientSecret: "secret" };
    const input = { code: "c", redirectUri: "https://x.example/cb", codeVerifier: "v" };
    await expect(
      exchangeGoogleCode(answer({ access_token: "a", refresh_token: "r", scope: GOOGLE_SCOPES[0] }), client, input),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      exchangeGoogleCode(answer({ access_token: "a", scope: GOOGLE_SCOPES.join(" ") }), client, input),
    ).rejects.toBeInstanceOf(ProviderError);
    const tokens = await exchangeGoogleCode(
      answer({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: GOOGLE_SCOPES.join(" ") }),
      client,
      input,
      1000,
    );
    expect(tokens).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 1000 + 3_600_000 });
  });
});

describe("shapes", () => {
  it("reads timed, all-day, deleted and free events", () => {
    expect(
      fromGoogle({ id: "a", summary: " Call ", start: { dateTime: "2026-12-02T10:00:00+01:00" }, end: { dateTime: "2026-12-02T11:00:00+01:00" }, etag: '"1"', updated: "2026-12-01T08:00:00Z" }, "Europe/Prague"),
    ).toMatchObject({ externalId: "a", title: "Call", startsAt: "2026-12-02T09:00:00.000Z", endsAt: "2026-12-02T10:00:00.000Z", allDay: false, cancelled: false });
    expect(fromGoogle({ id: "d", start: { date: "2026-12-24" }, end: { date: "2026-12-25" } }, "Europe/Prague")).toMatchObject({
      allDay: true,
      startsAt: "2026-12-23T23:00:00.000Z",
      endsAt: null,
    });
    expect(fromGoogle({ id: "x", status: "cancelled" }, "UTC")?.cancelled).toBe(true);
    expect(fromGoogle({ id: "f", transparency: "transparent", start: { dateTime: "2026-12-02T10:00:00Z" } }, "UTC")?.transparent).toBe(true);
    expect(fromGoogle({ id: "bad" }, "UTC")).toBeNull();
  });

  it("writes only what Gradus owns, all-day with an exclusive end", () => {
    const body = toGoogle({ id: "e", title: "Trip", description: null, location: null, startsAt: "2026-12-23T23:00:00.000Z", endsAt: "2026-12-25T23:00:00.000Z", allDay: true, timeZone: "Europe/Prague" });
    expect(body).toEqual({ summary: "Trip", description: "", location: "", start: { date: "2026-12-24" }, end: { date: "2026-12-27" } });
    const timed = toGoogle({ id: "e", title: "Call", description: "x", location: "y", startsAt: "2026-12-02T09:00:00.000Z", endsAt: null, allDay: false, timeZone: "Europe/Prague" });
    expect(timed.end).toEqual({ dateTime: "2026-12-02T10:00:00.000Z", timeZone: "Europe/Prague" });
  });

  it("takes only a real Meet link", () => {
    expect(meetLinkOf({ id: "a", hangoutLink: "https://meet.google.com/abc-defg-hij" })).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetLinkOf({ id: "a", hangoutLink: "https://evil.example/meet" })).toBeNull();
  });
});

describe("tokens", () => {
  it("refreshes an expired access token and hands the new one to be stored", async () => {
    const google = createMockGoogle();
    const stored: string[] = [];
    const provider = createGoogleProvider({
      tokens: { accessToken: "old", refreshToken: "rt", expiresAt: 0 },
      client: { clientId: "id", clientSecret: "secret" },
      fetcher: google.fetcher,
      timeZone: "UTC",
      onTokens: (tokens) => {
        stored.push(tokens.accessToken);
      },
    });
    const calendars = await provider.listCalendars();
    expect(calendars).toEqual([
      { externalId: "me@example.com", name: "Me", isPrimary: true, canWrite: true },
      { externalId: "holidays@group.v.calendar.google.com", name: "Holidays", isPrimary: false, canWrite: false },
    ]);
    expect(stored).toHaveLength(1);
    const list = google.requests.find((request) => request.url.pathname.endsWith("calendarList"))!;
    expect(list.headers.authorization).toBe(`Bearer ${stored[0]}`);
  });

  it("a refused refresh means connect again", async () => {
    const provider = createGoogleProvider({
      tokens: { accessToken: "old", refreshToken: "rt", expiresAt: 0 },
      client: { clientId: "id", clientSecret: "secret" },
      fetcher: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      timeZone: "UTC",
    });
    await expect(provider.listCalendars()).rejects.toMatchObject({ code: "auth" });
  });
});

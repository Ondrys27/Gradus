import type { GoogleEvent } from "../providers/google";
import type { Fetcher } from "../types";

/**
 * A small Google Calendar for the tests (28.10): events per calendar with
 * etags and a change log, `events.list` with `syncToken` (410 for a token it
 * forgot), `singleEvents` instances of series, PATCH with If-Match (412),
 * POST with a Meet conference, DELETE, the token endpoint. Only what the
 * provider calls; anything else is a 404.
 */

type Stored = GoogleEvent & { calendarId: string; seq: number };

export type MockGoogle = {
  fetcher: Fetcher;
  requests: { method: string; url: URL; body: unknown; headers: Record<string, string> }[];
  /** A change made "in Google" (by the person in Google's app). */
  upsert(calendarId: string, event: Omit<GoogleEvent, "etag" | "updated"> & { updated?: string }): GoogleEvent;
  remove(calendarId: string, id: string): void;
  get(calendarId: string, id: string): Stored | undefined;
  /** Tokens before this sequence are forgotten (410). */
  forgetTokensBefore(seq: number): void;
  setClock(ms: number): void;
};

export function createMockGoogle(start = Date.parse("2026-12-01T08:00:00Z")): MockGoogle {
  const events = new Map<string, Stored>();
  let seq = 0;
  let forgotten = 0;
  let clock = start;
  let idCounter = 0;
  const requests: MockGoogle["requests"] = [];
  const key = (calendarId: string, id: string) => `${calendarId}\u0000${id}`;

  function store(calendarId: string, event: GoogleEvent, updated?: string): Stored {
    seq += 1;
    const stored: Stored = {
      ...event,
      calendarId,
      seq,
      etag: `"e${seq}"`,
      updated: updated ?? new Date(clock).toISOString(),
    };
    events.set(key(calendarId, event.id), stored);
    return stored;
  }

  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const strip = (event: Stored): GoogleEvent => {
    const { calendarId: _calendar, seq: _seq, ...rest } = event;
    void _calendar;
    void _seq;
    return rest;
  };

  const fetcher: Fetcher = async (input, init = {}) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    const body =
      typeof init.body === "string"
        ? url.hostname === "oauth2.googleapis.com"
          ? Object.fromEntries(new URLSearchParams(init.body))
          : JSON.parse(init.body)
        : null;
    requests.push({ method, url, body, headers });

    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      return json(200, { access_token: `at-${++idCounter}`, expires_in: 3600 });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") return json(200, {});
    // Google Calendar API v3, under www.googleapis.com.
    const apiPath = url.pathname.replace(/^\/calendar\/v3/, "");
    if (apiPath === "/users/me/calendarList") {
      return json(200, {
        items: [
          { id: "me@example.com", summary: "Me", primary: true, accessRole: "owner" },
          { id: "holidays@group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" },
        ],
      });
    }
    const match = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(apiPath);
    if (!match) return json(404, { error: "notFound" });
    const calendarId = decodeURIComponent(match[1]);
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;

    if (!eventId && method === "GET") {
      const token = url.searchParams.get("syncToken");
      let since = 0;
      if (token) {
        since = Number(token.replace("tok:", ""));
        if (!Number.isFinite(since) || since < forgotten) return json(410, { error: "gone" });
      }
      const timeMin = Date.parse(url.searchParams.get("timeMin") ?? "");
      const timeMax = Date.parse(url.searchParams.get("timeMax") ?? "");
      const items = [...events.values()]
        .filter((event) => event.calendarId === calendarId && event.seq > since)
        .filter((event) => {
          if (token) return true;
          if (event.status === "cancelled") return false;
          const at = Date.parse(event.start?.dateTime ?? `${event.start?.date}T00:00:00Z`);
          return (!Number.isFinite(timeMin) || at >= timeMin) && (!Number.isFinite(timeMax) || at < timeMax);
        })
        .sort((a, b) => a.seq - b.seq)
        .map(strip);
      return json(200, { items, nextSyncToken: `tok:${seq}` });
    }
    if (!eventId && method === "POST") {
      const id = `g${++idCounter}`;
      const input = body as GoogleEvent & {
        conferenceData?: { createRequest?: { requestId: string } };
      };
      const created: GoogleEvent = {
        ...input,
        id,
        status: "confirmed",
        ...(input.conferenceData?.createRequest
          ? {
              hangoutLink: `https://meet.google.com/abc-${id}`,
              conferenceData: {
                entryPoints: [{ entryPointType: "video", uri: `https://meet.google.com/abc-${id}` }],
              },
            }
          : {}),
      };
      return json(200, strip(store(calendarId, created)));
    }
    if (!eventId) return json(404, {});
    const current = events.get(key(calendarId, eventId));
    if (method === "GET") {
      if (!current || current.status === "cancelled") return json(404, {});
      return json(200, strip(current));
    }
    if (method === "PATCH") {
      if (!current || current.status === "cancelled") return json(404, {});
      if (headers["if-match"] && headers["if-match"] !== current.etag) return json(412, {});
      const patch = body as GoogleEvent;
      return json(200, strip(store(calendarId, { ...strip(current), ...patch, id: eventId })));
    }
    if (method === "DELETE") {
      if (!current || current.status === "cancelled") return json(410, {});
      store(calendarId, { id: eventId, status: "cancelled" });
      return new Response(null, { status: 204 });
    }
    return json(405, {});
  };

  return {
    fetcher,
    requests,
    upsert(calendarId, event) {
      const { updated, ...rest } = event;
      return strip(store(calendarId, { status: "confirmed", ...rest } as GoogleEvent, updated));
    },
    remove(calendarId, id) {
      store(calendarId, { id, status: "cancelled" });
    },
    get(calendarId, id) {
      return events.get(key(calendarId, id));
    },
    forgetTokensBefore(value) {
      forgotten = value;
    },
    setClock(ms) {
      clock = ms;
    },
  };
}

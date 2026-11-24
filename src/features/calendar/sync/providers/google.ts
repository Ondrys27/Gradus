import {
  allDayDays,
  allDayInstants,
  codeOfStatus,
  ProviderError,
  type CalendarProvider,
  type Fetcher,
  type LinkTarget,
  type OutgoingEvent,
  type PullResult,
  type PutResult,
  type RemoteCalendar,
  type RemoteEvent,
  type SyncWindow,
} from "../types";

/**
 * Google Calendar (28.10) over its REST API, with an injected `fetch` so the
 * tests answer as a mock Google. Scopes: calendar.events (read and write
 * events) and calendar.calendarlist.readonly (the list of calendars), with
 * offline access. Nothing else is asked for.
 *
 * Reading: instances of series one by one (`singleEvents=true`), first from
 * the window's start to its end, then only what changed (`syncToken`); a
 * forgotten token (410) reads everything again. Writing: PATCH with the
 * etag held (412 = the other side changed: the caller decides who wins), one
 * instance of a series by its own id (Google keeps it as an exception).
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

/** Pages of one read; more means a calendar too big to mirror whole (the rest waits). */
const MAX_PAGES = 20;
const PAGE_SIZE = 2500;
const TIMEOUT_MS = 15_000;

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch. */
  expiresAt: number;
};

export type GoogleClient = { clientId: string; clientSecret: string };

async function call(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ProviderError("network");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError("unknown", response.status);
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** The consent page: offline access (a refresh token) and the consent asked every time. */
export function googleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type TokenAnswer = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

/** The code from the callback for tokens; every scope we asked for must have been granted. */
export async function exchangeGoogleCode(
  fetcher: Fetcher,
  client: GoogleClient,
  input: { code: string; redirectUri: string; codeVerifier: string },
  now = Date.now(),
): Promise<GoogleTokens> {
  const response = await call(fetcher, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: input.codeVerifier,
    }).toString(),
  });
  const body = await readJson<TokenAnswer>(response).catch(() => ({}) as TokenAnswer);
  if (!response.ok || !body.access_token) throw new ProviderError("auth", response.status);
  if (!body.refresh_token) throw new ProviderError("auth", response.status);
  const granted = new Set((body.scope ?? "").split(/\s+/));
  if (!GOOGLE_SCOPES.every((scope) => granted.has(scope))) throw new ProviderError("forbidden");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + Math.max(60, body.expires_in ?? 3600) * 1000,
  };
}

/** Takes the access back at Google (Disconnect); a failure only reaches the log. */
export async function revokeGoogleToken(fetcher: Fetcher, token: string): Promise<boolean> {
  const response = await call(fetcher, GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => null);
  return Boolean(response?.ok);
}

// ---------------------------------------------------------------------------
// Events: Google's shape <-> ours
// ---------------------------------------------------------------------------

type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };

export type GoogleEvent = {
  id: string;
  status?: string;
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurringEventId?: string;
  transparency?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Google's event as ours; null for one we cannot place in time. */
export function fromGoogle(item: GoogleEvent, timeZone: string): RemoteEvent | null {
  const base = {
    externalId: item.id,
    recurringId: item.recurringEventId ?? null,
    etag: item.etag ?? null,
    updatedAt: item.updated ?? null,
    title: (item.summary ?? "").trim(),
    description: item.description?.trim() || null,
    location: item.location?.trim() || null,
    transparent: item.transparency === "transparent",
  };
  if (item.status === "cancelled") {
    // A deleted event carries only its id for sure.
    return { ...base, cancelled: true, startsAt: new Date(0).toISOString(), endsAt: null, allDay: false };
  }
  const start = item.start;
  if (!start) return null;
  if (start.date && DAY.test(start.date)) {
    const end = item.end?.date && DAY.test(item.end.date) ? item.end.date : null;
    const { startsAt, endsAt } = allDayInstants(start.date, end, timeZone);
    return { ...base, cancelled: false, startsAt, endsAt, allDay: true };
  }
  const startsMs = Date.parse(start.dateTime ?? "");
  if (!Number.isFinite(startsMs)) return null;
  const endMs = Date.parse(item.end?.dateTime ?? "");
  return {
    ...base,
    cancelled: false,
    startsAt: new Date(startsMs).toISOString(),
    endsAt: new Date(Number.isFinite(endMs) && endMs > startsMs ? endMs : startsMs).toISOString(),
    allDay: false,
  };
}

/** The meeting link Google made (Meet), if any. */
export function meetLinkOf(item: GoogleEvent): string | null {
  const video = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video");
  const link = video?.uri ?? item.hangoutLink ?? null;
  return link && /^https:\/\/meet\.google\.com\/[A-Za-z0-9/_-]+$/.test(link) ? link : null;
}

/** Our event as the fields Google gets; only what Gradus owns, so the rest stays as it was. */
export function toGoogle(event: OutgoingEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
  };
  if (event.allDay) {
    const days = allDayDays(event.startsAt, event.endsAt, event.timeZone);
    body.start = { date: days.start };
    body.end = { date: days.endExclusive };
  } else {
    const end = event.endsAt ?? new Date(Date.parse(event.startsAt) + 3_600_000).toISOString();
    body.start = { dateTime: event.startsAt, timeZone: event.timeZone };
    body.end = { dateTime: end, timeZone: event.timeZone };
  }
  if (event.attendees?.length) {
    body.attendees = event.attendees.map((attendee) => ({
      email: attendee.email,
      ...(attendee.name ? { displayName: attendee.name } : {}),
    }));
  }
  if (event.conference) {
    body.conferenceData = {
      createRequest: {
        requestId: event.conference.requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export type GoogleProviderOptions = {
  tokens: GoogleTokens;
  client: GoogleClient;
  fetcher: Fetcher;
  /** The person's zone: all-day days, the wall clock of what we write. */
  timeZone: string;
  /** New tokens after a refresh, to store (encrypted) again. */
  onTokens?: (tokens: GoogleTokens) => Promise<void> | void;
  now?: () => number;
};

export type GoogleProvider = CalendarProvider & {
  watch(
    calendarId: string,
    channel: { id: string; token: string; address: string; expiresAt?: number },
  ): Promise<{ resourceId: string; expiresAt: number | null }>;
  stopWatch(channelId: string, resourceId: string): Promise<void>;
};

export function createGoogleProvider(options: GoogleProviderOptions): GoogleProvider {
  const now = options.now ?? Date.now;
  let tokens = options.tokens;

  async function refresh(): Promise<string> {
    const response = await call(options.fetcher, GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: options.client.clientId,
        client_secret: options.client.clientSecret,
      }).toString(),
    });
    const body = await readJson<TokenAnswer>(response).catch(() => ({}) as TokenAnswer);
    if (!response.ok || !body.access_token) {
      // invalid_grant: the access was taken back (or expired in Testing): connect again.
      throw new ProviderError(response.status >= 500 ? "network" : "auth", response.status);
    }
    tokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? tokens.refreshToken,
      expiresAt: now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    await options.onTokens?.(tokens);
    return tokens.accessToken;
  }

  async function accessToken(): Promise<string> {
    if (tokens.expiresAt - 60_000 > now()) return tokens.accessToken;
    return refresh();
  }

  async function api(
    method: string,
    path: string,
    init: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = `${API}${path}${init.query ? `?${new URLSearchParams(init.query).toString()}` : ""}`;
    const send = async (token: string) =>
      call(options.fetcher, url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    let response = await send(await accessToken());
    // An access token that died early: one refresh, one more try.
    if (response.status === 401) response = await send(await refresh());
    return response;
  }

  const path = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}`;
  const eventPath = (calendarId: string, eventId: string) =>
    `${path(calendarId)}/events/${encodeURIComponent(eventId)}`;

  async function failed(response: Response): Promise<never> {
    throw new ProviderError(codeOfStatus(response.status), response.status);
  }

  async function getEvent(calendarId: string, externalId: string): Promise<RemoteEvent | null> {
    const response = await api("GET", eventPath(calendarId, externalId));
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) return failed(response);
    const item = await readJson<GoogleEvent>(response);
    const event = fromGoogle(item, options.timeZone);
    return event && !event.cancelled ? event : null;
  }

  return {
    key: "google",

    async listCalendars(): Promise<RemoteCalendar[]> {
      const out: RemoteCalendar[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < 10; page++) {
        const query: Record<string, string> = { maxResults: "250", minAccessRole: "reader" };
        if (pageToken) query.pageToken = pageToken;
        const response = await api("GET", "/users/me/calendarList", { query });
        if (!response.ok) return failed(response);
        const body = await readJson<{
          items?: {
            id: string;
            summary?: string;
            summaryOverride?: string;
            primary?: boolean;
            accessRole?: string;
            deleted?: boolean;
          }[];
          nextPageToken?: string;
        }>(response);
        for (const item of body.items ?? []) {
          if (item.deleted || !item.id) continue;
          out.push({
            externalId: item.id,
            name: (item.summaryOverride || item.summary || item.id).slice(0, 200),
            isPrimary: item.primary === true,
            canWrite: item.accessRole === "owner" || item.accessRole === "writer",
          });
        }
        pageToken = body.nextPageToken ?? null;
        if (!pageToken) break;
      }
      return out;
    },

    async pull(calendarId: string, state: string | null, window: SyncWindow): Promise<PullResult> {
      const read = async (token: string | null) => {
        const events: RemoteEvent[] = [];
        let pageToken: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const query: Record<string, string> = { singleEvents: "true", maxResults: String(PAGE_SIZE) };
          if (token) query.syncToken = token;
          else {
            query.timeMin = new Date(window.from).toISOString();
            query.timeMax = new Date(window.to).toISOString();
          }
          if (pageToken) query.pageToken = pageToken;
          const response = await api("GET", `${path(calendarId)}/events`, { query });
          if (response.status === 410 && token) return null;
          if (!response.ok) return failed(response);
          const body = await readJson<{
            items?: GoogleEvent[];
            nextPageToken?: string;
            nextSyncToken?: string;
          }>(response);
          for (const item of body.items ?? []) {
            const event = fromGoogle(item, options.timeZone);
            if (event) events.push(event);
          }
          if (body.nextPageToken) {
            pageToken = body.nextPageToken;
            continue;
          }
          return { events, state: body.nextSyncToken ?? null, complete: true };
        }
        // Too big to read whole now: what came is kept, nothing is taken as gone.
        return { events, state: null, complete: false };
      };

      const empty = { removed: [], removedSeries: [], completeSeries: [] };
      if (state) {
        const incremental = await read(state);
        if (incremental) return { ...empty, full: false, events: incremental.events, state: incremental.state };
      }
      // First time, or Google forgot the token: everything again.
      const full = await read(null);
      if (!full) return { ...empty, full: false, events: [], state: null };
      return { ...empty, full: full.complete, events: full.events, state: full.state };
    },

    getEvent,

    async putEvent(calendarId: string, event: OutgoingEvent, target: LinkTarget | null): Promise<PutResult> {
      const query: Record<string, string> = {
        conferenceDataVersion: "1",
        // The guest has the invitation from Gradus already: Google sends nothing.
        sendUpdates: "none",
      };
      const body = toGoogle(event);
      const response = target
        ? await api("PATCH", eventPath(calendarId, target.externalId), {
            query,
            body,
            headers: target.etag ? { "if-match": target.etag } : {},
          })
        : await api("POST", `${path(calendarId)}/events`, { query, body });
      if (target && response.status === 412) {
        return { ok: false, reason: "conflict", remote: await getEvent(calendarId, target.externalId) };
      }
      if (target && (response.status === 404 || response.status === 410)) {
        return { ok: false, reason: "gone" };
      }
      if (!response.ok) return failed(response);
      const item = await readJson<GoogleEvent>(response);
      const stored = fromGoogle(item, options.timeZone);
      if (!stored || stored.cancelled) return { ok: false, reason: "gone" };
      return { ok: true, event: stored, meetLink: meetLinkOf(item) };
    },

    async deleteEvent(calendarId: string, target: LinkTarget): Promise<void> {
      // Deleting in Gradus wins whatever changed there meanwhile: no etag.
      const response = await api("DELETE", eventPath(calendarId, target.externalId), {
        query: { sendUpdates: "none" },
      });
      if (response.ok || response.status === 404 || response.status === 410) return;
      return failed(response);
    },

    async watch(calendarId, channel) {
      const response = await api("POST", `${path(calendarId)}/events/watch`, {
        body: {
          id: channel.id,
          type: "web_hook",
          address: channel.address,
          token: channel.token,
          ...(channel.expiresAt ? { expiration: String(channel.expiresAt) } : {}),
        },
      });
      if (!response.ok) return failed(response);
      const body = await readJson<{ resourceId?: string; expiration?: string }>(response);
      if (!body.resourceId) throw new ProviderError("unknown", response.status);
      const expires = Number(body.expiration);
      return { resourceId: body.resourceId, expiresAt: Number.isFinite(expires) ? expires : null };
    },

    async stopWatch(channelId, resourceId) {
      const response = await api("POST", "/channels/stop", { body: { id: channelId, resourceId } });
      if (response.ok || response.status === 404) return;
      return failed(response);
    },
  };
}

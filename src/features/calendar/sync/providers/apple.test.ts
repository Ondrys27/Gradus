import { describe, expect, it } from "vitest";
import { icsInstances } from "@/features/scheduler/ics/parse";
import { ProviderError, type Fetcher, type OutgoingEvent, type RemoteEvent } from "../types";
import { createAppleProvider, discoverApple, isAppleUrl } from "./apple";

// ---------------------------------------------------------------------------
// A small CalDAV server in memory, answering like iCloud does
// ---------------------------------------------------------------------------

type Resource = { data: string; etag: string };
type Collection = {
  name: string;
  components: string[];
  canWrite: boolean;
  order?: number;
  ctag: number;
  resources: Map<string, Resource>;
};
type Logged = { method: string; url: string; headers: Headers; body: string };

const USER = "jan@icloud.com";
const PASSWORD = "abcd-efgh-ijkl-mnop";
const HOME = "https://p47-caldav.icloud.com/123/calendars/";
const WORK = `${HOME}work/`;
const PRAGUE = "Europe/Prague";
const NOW = new Date("2026-11-24T10:00:00Z");

const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const multistatus = (responses: string[]) =>
  `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" ` +
  `xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">${responses.join("")}</D:multistatus>`;

const ok = (href: string, props: string) =>
  `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${props}</D:prop>` +
  "<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>";

const missing = (href: string) =>
  `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;

class MockCalDav {
  password = PASSWORD;
  /** The calendar-home-set the principal answers with. */
  homeHref = "https://p47-caldav.icloud.com:443/123/calendars/";
  omitPutEtag = false;
  /** Runs after a GET answer, to change the resource behind the client's back. */
  afterGet: (() => void) | null = null;
  requests: Logged[] = [];
  collections = new Map<string, Collection>();
  private counter = 0;

  constructor() {
    this.collections.set("/123/calendars/work/", {
      name: "Práce",
      components: ["VEVENT"],
      canWrite: true,
      order: 2,
      ctag: 1,
      resources: new Map(),
    });
  }

  nextEtag(): string {
    this.counter += 1;
    return `"e${this.counter}"`;
  }

  put(path: string, data: string): Resource {
    const collection = this.collectionOf(path)!;
    const resource = { data, etag: this.nextEtag() };
    collection.resources.set(path, resource);
    collection.ctag += 1;
    return resource;
  }

  remove(path: string): void {
    const collection = this.collectionOf(path)!;
    collection.resources.delete(path);
    collection.ctag += 1;
  }

  resource(path: string): Resource | undefined {
    return this.collectionOf(path)?.resources.get(path);
  }

  private collectionOf(path: string): Collection | undefined {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return this.collections.get(dir);
  }

  fetcher: Fetcher = async (url, init) => {
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const method = init?.method ?? "GET";
    this.requests.push({ method, url, headers, body });
    const expected = `Basic ${Buffer.from(`${USER}:${this.password}`).toString("base64")}`;
    if (headers.get("authorization") !== expected) return new Response("", { status: 401 });
    const { host, pathname: path } = new URL(url);

    if (host === "caldav.icloud.com") {
      if (method === "PROPFIND" && path === "/") {
        return xmlAnswer(
          `<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop>` +
            "<current-user-principal><href>/123/principal/</href></current-user-principal>" +
            "</prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>",
        );
      }
      if (method === "PROPFIND" && path === "/123/principal/") {
        return xmlAnswer(
          multistatus([
            ok(
              "/123/principal/",
              `<C:calendar-home-set><D:href>${this.homeHref}</D:href></C:calendar-home-set>`,
            ),
          ]),
        );
      }
      return new Response("", { status: 404 });
    }
    if (host !== "p47-caldav.icloud.com") return new Response("", { status: 404 });

    const collection = this.collections.get(path);
    if (method === "PROPFIND" && path === "/123/calendars/") {
      const responses = [ok(path, "<D:resourcetype><D:collection/></D:resourcetype>")];
      for (const [href, item] of this.collections) {
        const write = item.canWrite ? "<D:privilege><D:write/></D:privilege>" : "";
        responses.push(
          ok(
            href,
            "<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>" +
              `<D:displayname>${xml(item.name)}</D:displayname><CS:getctag>c${item.ctag}</CS:getctag>` +
              `<C:supported-calendar-component-set>${item.components.map((name) => `<C:comp name="${name}"/>`).join("")}</C:supported-calendar-component-set>` +
              `<D:current-user-privilege-set><D:privilege><D:read/></D:privilege>${write}</D:current-user-privilege-set>` +
              (item.order !== undefined
                ? `<A:calendar-order>${item.order}</A:calendar-order>`
                : ""),
          ),
        );
      }
      responses.push(
        ok(
          "/123/calendars/inbox/",
          "<D:resourcetype><D:collection/><C:schedule-inbox/></D:resourcetype>",
        ),
      );
      return xmlAnswer(multistatus(responses));
    }
    if (method === "PROPFIND" && collection) {
      return xmlAnswer(multistatus([ok(path, `<CS:getctag>c${collection.ctag}</CS:getctag>`)]));
    }
    if (method === "PROPFIND") {
      const resource = this.resource(path);
      if (!resource) return new Response("", { status: 404 });
      return xmlAnswer(multistatus([ok(path, `<D:getetag>${resource.etag}</D:getetag>`)]));
    }
    if (method === "REPORT" && collection && body.includes("calendar-query")) {
      const range = /start="(\d{8}T\d{6}Z)" end="(\d{8}T\d{6}Z)"/.exec(body);
      const from = range ? icsToMs(range[1]) : -Infinity;
      const to = range ? icsToMs(range[2]) : Infinity;
      const responses: string[] = [];
      for (const [href, resource] of collection.resources) {
        const inside = icsInstances(resource.data, { from, to, defaultTimeZone: "UTC" }).length > 0;
        if (inside) responses.push(ok(href, `<D:getetag>${resource.etag}</D:getetag>`));
      }
      return xmlAnswer(multistatus(responses));
    }
    if (method === "REPORT" && collection && body.includes("calendar-multiget")) {
      const withData = body.includes("calendar-data");
      const hrefs = [...body.matchAll(/<d:href>([^<]*)<\/d:href>/g)].map((match) => match[1]);
      const responses = hrefs.map((href) => {
        const resource = collection.resources.get(href);
        if (!resource) return missing(href);
        const data = withData ? `<C:calendar-data>${xml(resource.data)}</C:calendar-data>` : "";
        return ok(href, `<D:getetag>${resource.etag}</D:getetag>${data}`);
      });
      return xmlAnswer(multistatus(responses));
    }
    if (method === "GET") {
      const resource = this.resource(path);
      if (!resource) return new Response("", { status: 404 });
      const answer = new Response(resource.data, {
        status: 200,
        headers: { ETag: resource.etag, "Content-Type": "text/calendar" },
      });
      this.afterGet?.();
      return answer;
    }
    if (method === "PUT") {
      if (!this.collectionOf(path)) return new Response("", { status: 409 });
      const current = this.resource(path);
      if (headers.get("if-none-match") === "*" && current) return new Response("", { status: 412 });
      const ifMatch = headers.get("if-match");
      if (ifMatch && ifMatch !== current?.etag) return new Response("", { status: 412 });
      const stored = this.put(path, body);
      return new Response(null, {
        status: current ? 204 : 201,
        headers: this.omitPutEtag ? {} : { ETag: stored.etag },
      });
    }
    if (method === "DELETE") {
      const current = this.resource(path);
      if (!current) return new Response("", { status: 404 });
      const ifMatch = headers.get("if-match");
      if (ifMatch && ifMatch !== current.etag) return new Response("", { status: 412 });
      this.remove(path);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 405 });
  };

  count(method: string, contains?: string): number {
    return this.requests.filter(
      (request) => request.method === method && (!contains || request.body.includes(contains)),
    ).length;
  }
}

function xmlAnswer(body: string): Response {
  return new Response(body, { status: 207, headers: { "Content-Type": "application/xml" } });
}

function icsToMs(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const cal = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//iCloud//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";

const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const PRAGUE_TZ = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Prague",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "DTSTART:19810329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "DTSTART:19961027T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

/** Mondays 9:00 in Prague over the October DST change: 19. 10. excluded, 26. 10. moved. */
const SERIES = cal(
  PRAGUE_TZ,
  ev(
    "UID:weekly-1",
    "DTSTAMP:20261001T080000Z",
    "LAST-MODIFIED:20261002T080000Z",
    "SEQUENCE:2",
    "DTSTART;TZID=Europe/Prague:20261012T090000",
    "DTEND;TZID=Europe/Prague:20261012T100000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "EXDATE;TZID=Europe/Prague:20261019T090000",
    "SUMMARY:Porada",
    "LOCATION:Kancelář",
    "X-CUSTOM:keep me",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "END:VALARM",
  ),
  ev(
    "UID:weekly-1",
    "DTSTAMP:20261003T080000Z",
    "RECURRENCE-ID;TZID=Europe/Prague:20261026T090000",
    "DTSTART;TZID=Europe/Prague:20261027T140000",
    "DTEND;TZID=Europe/Prague:20261027T150000",
    "SUMMARY:Porada (přesunutá)",
  ),
);

const WINDOW = { from: Date.parse("2026-10-01T00:00:00Z"), to: Date.parse("2026-11-12T00:00:00Z") };
const SERIES_PATH = "/123/calendars/work/weekly.ics";
const SERIES_URL = `https://p47-caldav.icloud.com${SERIES_PATH}`;

function setup() {
  const server = new MockCalDav();
  const provider = createAppleProvider({
    username: USER,
    password: PASSWORD,
    fetcher: server.fetcher,
    homeUrl: HOME,
    timeZone: PRAGUE,
    now: () => NOW,
  });
  return { server, provider };
}

const outgoing = (patch: Partial<OutgoingEvent> = {}): OutgoingEvent => ({
  id: "6f1c2a7e-0d4b-4a39-9b51-1f3e5c7d9a20",
  title: "Schůzka s klientem",
  description: null,
  location: null,
  startsAt: "2026-11-10T09:00:00.000Z",
  endsAt: "2026-11-10T10:00:00.000Z",
  allDay: false,
  timeZone: PRAGUE,
  ...patch,
});

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error("expected a ProviderError");
}

const byStart = (events: RemoteEvent[]) =>
  [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

// ---------------------------------------------------------------------------

describe("isAppleUrl", () => {
  it("accepts only https hosts under icloud.com", () => {
    expect(isAppleUrl("https://caldav.icloud.com/")).toBe(true);
    expect(isAppleUrl("https://p47-caldav.icloud.com:443/1/calendars/")).toBe(true);
    expect(isAppleUrl("http://caldav.icloud.com/")).toBe(false);
    expect(isAppleUrl("https://icloud.com.evil.example/")).toBe(false);
    expect(isAppleUrl("https://evilicloud.com/")).toBe(false);
    expect(isAppleUrl("https://p47-caldav.icloud.com.evil.example/")).toBe(false);
    expect(isAppleUrl("https://p47-caldav.icloud.com:8443/")).toBe(false);
    expect(isAppleUrl("https://user:pw@caldav.icloud.com/")).toBe(false);
    expect(isAppleUrl("not a url")).toBe(false);
  });
});

describe("discoverApple", () => {
  it("finds the principal and the calendar home on another iCloud host", async () => {
    const server = new MockCalDav();
    const found = await discoverApple({ username: USER, password: PASSWORD }, server.fetcher);
    expect(found).toEqual({
      principalUrl: "https://caldav.icloud.com/123/principal/",
      homeUrl: HOME,
    });
    expect(
      server.requests.map((request) => [request.method, request.headers.get("depth")]),
    ).toEqual([
      ["PROPFIND", "0"],
      ["PROPFIND", "0"],
    ]);
  });

  it("says auth when the password is wrong", async () => {
    const server = new MockCalDav();
    server.password = "something-else";
    const error = await rejection(
      discoverApple({ username: USER, password: PASSWORD }, server.fetcher),
    );
    expect(error.code).toBe("auth");
    expect(error.message).not.toContain(PASSWORD);
  });

  it("refuses a home outside iCloud and never sends the password there", async () => {
    for (const home of [
      "https://evil.example/123/calendars/",
      "https://p47-caldav.icloud.com.evil.example/123/",
      "http://p47-caldav.icloud.com/123/calendars/",
    ]) {
      const server = new MockCalDav();
      server.homeHref = home;
      const error = await rejection(
        discoverApple({ username: USER, password: PASSWORD }, server.fetcher),
      );
      expect(error.code).toBe("invalid");
      expect(server.requests.every((request) => isAppleUrl(request.url))).toBe(true);
    }
  });

  it("follows at most three redirects and only inside iCloud", async () => {
    const server = new MockCalDav();
    let hops = 0;
    const redirecting: Fetcher = async (url, init) => {
      if (url === "https://caldav.icloud.com/") {
        hops += 1;
        return new Response(null, { status: 301, headers: { Location: "https://evil.example/" } });
      }
      return server.fetcher(url, init);
    };
    expect(
      (await rejection(discoverApple({ username: USER, password: PASSWORD }, redirecting))).code,
    ).toBe("invalid");
    expect(hops).toBe(1);

    const loop: Fetcher = async () =>
      new Response(null, { status: 302, headers: { Location: "https://caldav.icloud.com/" } });
    expect(
      (await rejection(discoverApple({ username: USER, password: PASSWORD }, loop))).code,
    ).toBe("invalid");
  });

  it("maps a network failure without leaking it", async () => {
    const broken: Fetcher = async () => {
      throw new TypeError(`fetch failed for ${USER}`);
    };
    const error = await rejection(discoverApple({ username: USER, password: PASSWORD }, broken));
    expect(error.code).toBe("network");
    expect(error.message).not.toContain(USER);
  });
});

describe("listCalendars", () => {
  it("keeps event calendars, reads write access and picks the primary", async () => {
    const { server, provider } = setup();
    server.collections.set("/123/calendars/home/", {
      name: "Domů",
      components: ["VEVENT", "VTODO"],
      canWrite: true,
      order: 5,
      ctag: 1,
      resources: new Map(),
    });
    server.collections.set("/123/calendars/reminders/", {
      name: "Připomínky",
      components: ["VTODO"],
      canWrite: true,
      order: 0,
      ctag: 1,
      resources: new Map(),
    });
    server.collections.set("/123/calendars/shared/", {
      name: "Sdílený",
      components: ["VEVENT"],
      canWrite: false,
      order: 1,
      ctag: 1,
      resources: new Map(),
    });
    const calendars = await provider.listCalendars();
    expect(calendars).toEqual([
      { externalId: `${HOME}shared/`, name: "Sdílený", isPrimary: false, canWrite: false },
      { externalId: WORK, name: "Práce", isPrimary: false, canWrite: true },
      { externalId: `${HOME}home/`, name: "Domů", isPrimary: true, canWrite: true },
    ]);
  });

  it("discovers the home on first use when it is not given", async () => {
    const server = new MockCalDav();
    const provider = createAppleProvider({
      username: USER,
      password: PASSWORD,
      fetcher: server.fetcher,
    });
    const calendars = await provider.listCalendars();
    expect(calendars.map((calendar) => calendar.externalId)).toEqual([WORK]);
    expect(calendars[0].isPrimary).toBe(true);
  });
});

describe("pull", () => {
  it("expands a series over the DST change with its exclusion and moved occurrence", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    const etag = server.resource(SERIES_PATH)!.etag;
    const result = await provider.pull(WORK, null, WINDOW);
    expect(result.full).toBe(true);
    expect(result.completeSeries).toEqual([SERIES_URL]);
    const events = byStart(result.events);
    expect(
      events.map((event) => [event.externalId.split("#")[1], event.startsAt, event.endsAt]),
    ).toEqual([
      // CEST: 9:00 = 7:00 UTC
      ["20261012T070000Z", "2026-10-12T07:00:00.000Z", "2026-10-12T08:00:00.000Z"],
      // Moved from Monday 26. 10. (CET, 8:00 UTC) to Tuesday 14:00.
      ["20261026T080000Z", "2026-10-27T13:00:00.000Z", "2026-10-27T14:00:00.000Z"],
      ["20261102T080000Z", "2026-11-02T08:00:00.000Z", "2026-11-02T09:00:00.000Z"],
      ["20261109T080000Z", "2026-11-09T08:00:00.000Z", "2026-11-09T09:00:00.000Z"],
    ]);
    for (const event of events) {
      expect(event.recurringId).toBe(SERIES_URL);
      expect(event.etag).toBe(etag);
      expect(event.externalId.startsWith(`${SERIES_URL}#`)).toBe(true);
    }
    expect(events[0]).toMatchObject({
      title: "Porada",
      location: "Kancelář",
      updatedAt: "2026-10-02T08:00:00.000Z",
    });
    expect(events[1]).toMatchObject({ title: "Porada (přesunutá)", location: "Kancelář" });
    expect(result.state).toBe(`c${server.collections.get("/123/calendars/work/")!.ctag}`);
  });

  it("maps all-day events to Gradus's convention and leaves cancelled ones out", async () => {
    const { server, provider } = setup();
    server.put(
      "/123/calendars/work/trip.ics",
      cal(
        ev(
          "UID:trip",
          "DTSTART;VALUE=DATE:20261103",
          "DTEND;VALUE=DATE:20261105",
          "SUMMARY:Cesta",
          "TRANSP:TRANSPARENT",
        ),
      ),
    );
    server.put(
      "/123/calendars/work/day.ics",
      cal(ev("UID:day", "DTSTART;VALUE=DATE:20261106", "DTEND;VALUE=DATE:20261107", "SUMMARY:Den")),
    );
    server.put(
      "/123/calendars/work/off.ics",
      cal(
        ev(
          "UID:off",
          "DTSTART:20261106T090000Z",
          "DTEND:20261106T100000Z",
          "STATUS:CANCELLED",
          "SUMMARY:Zrušeno",
        ),
      ),
    );
    const events = byStart((await provider.pull(WORK, null, WINDOW)).events);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      externalId: `${HOME}work/trip.ics`,
      recurringId: `${HOME}work/trip.ics`,
      allDay: true,
      startsAt: "2026-11-02T23:00:00.000Z",
      endsAt: "2026-11-03T23:00:00.000Z",
      transparent: true,
      title: "Cesta",
    });
    expect(events[1]).toMatchObject({
      allDay: true,
      startsAt: "2026-11-05T23:00:00.000Z",
      endsAt: null,
    });
  });

  it("reads nothing more when the ctag has not changed", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    const first = await provider.pull(WORK, null, WINDOW);
    server.requests = [];
    const again = await provider.pull(WORK, first.state, WINDOW, new Map([[SERIES_URL, "x"]]));
    expect(again).toEqual({
      full: false,
      events: [],
      removed: [],
      removedSeries: [],
      completeSeries: [],
      state: first.state,
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].method).toBe("PROPFIND");
  });

  it("reads only changed resources and reports the ones that are gone", async () => {
    const { server, provider } = setup();
    const paths = ["a", "b", "c"].map((name) => `/123/calendars/work/${name}.ics`);
    paths.forEach((path, index) =>
      server.put(
        path,
        cal(
          ev(
            `UID:${index}`,
            `DTSTART:2026110${index + 1}T090000Z`,
            `DTEND:2026110${index + 1}T100000Z`,
            `SUMMARY:E${index}`,
          ),
        ),
      ),
    );
    const first = await provider.pull(WORK, null, WINDOW);
    expect(first.events).toHaveLength(3);
    const known = new Map(first.events.map((event) => [event.recurringId!, event.etag!]));

    server.put(
      paths[1],
      cal(ev("UID:1", "DTSTART:20261102T120000Z", "DTEND:20261102T130000Z", "SUMMARY:E1 later")),
    );
    server.remove(paths[2]);
    server.requests = [];
    const next = await provider.pull(WORK, first.state, WINDOW, known);

    expect(next.full).toBe(false);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({
      title: "E1 later",
      startsAt: "2026-11-02T12:00:00.000Z",
    });
    expect(next.completeSeries).toEqual([`https://p47-caldav.icloud.com${paths[1]}`]);
    expect(next.removedSeries).toEqual([`https://p47-caldav.icloud.com${paths[2]}`]);
    expect(next.state).not.toBe(first.state);
    // ctag, calendar-query, existence of the missing one, data of the changed one.
    expect(server.requests.map((request) => request.method)).toEqual([
      "PROPFIND",
      "REPORT",
      "REPORT",
      "REPORT",
    ]);
    const dataRead = server.requests.find((request) => request.body.includes("calendar-data"))!;
    expect(dataRead.body).toContain(paths[1]);
    expect(dataRead.body).not.toContain(paths[0]);
  });

  it("reads again a known resource that moved out of the window", async () => {
    const { server, provider } = setup();
    const path = "/123/calendars/work/moved.ics";
    server.put(
      path,
      cal(ev("UID:m", "DTSTART:20261103T090000Z", "DTEND:20261103T100000Z", "SUMMARY:M")),
    );
    const first = await provider.pull(WORK, null, WINDOW);
    const known = new Map(first.events.map((event) => [event.recurringId!, event.etag!]));
    server.put(
      path,
      cal(ev("UID:m", "DTSTART:20270303T090000Z", "DTEND:20270303T100000Z", "SUMMARY:M")),
    );
    const next = await provider.pull(WORK, first.state, WINDOW, known);
    expect(next.removedSeries).toEqual([]);
    expect(next.completeSeries).toEqual([`https://p47-caldav.icloud.com${path}`]);
    expect(next.events).toEqual([]);
  });

  it("reads changed resources in batches of 50", async () => {
    const { server, provider } = setup();
    for (let index = 0; index < 120; index++) {
      server.put(
        `/123/calendars/work/r${index}.ics`,
        cal(ev(`UID:r${index}`, "DTSTART:20261103T090000Z", "DTEND:20261103T100000Z", "SUMMARY:R")),
      );
    }
    const result = await provider.pull(WORK, null, WINDOW);
    expect(result.events).toHaveLength(120);
    expect(server.count("REPORT", "calendar-multiget")).toBe(3);
  });
});

describe("getEvent", () => {
  it("returns one occurrence, a moved one at its new time, null when excluded or gone", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    expect(await provider.getEvent(WORK, `${SERIES_URL}#20261102T080000Z`)).toMatchObject({
      startsAt: "2026-11-02T08:00:00.000Z",
      title: "Porada",
    });
    expect(await provider.getEvent(WORK, `${SERIES_URL}#20261026T080000Z`)).toMatchObject({
      startsAt: "2026-10-27T13:00:00.000Z",
      title: "Porada (přesunutá)",
    });
    expect(await provider.getEvent(WORK, `${SERIES_URL}#20261019T070000Z`)).toBeNull();
    expect(await provider.getEvent(WORK, `${HOME}work/none.ics`)).toBeNull();
  });

  it("refuses an event outside the calendar", async () => {
    const { provider } = setup();
    expect((await rejection(provider.getEvent(WORK, "https://evil.example/x.ics"))).code).toBe(
      "invalid",
    );
    expect((await rejection(provider.getEvent(WORK, `${HOME}other/x.ics`))).code).toBe("invalid");
    expect((await rejection(provider.getEvent(WORK, `${SERIES_URL}#tomorrow`))).code).toBe(
      "invalid",
    );
  });
});

describe("putEvent", () => {
  it("creates a timed event with If-None-Match and UTC times", async () => {
    const { server, provider } = setup();
    const result = await provider.putEvent(WORK, outgoing(), null);
    const url = `${WORK}6f1c2a7e-0d4b-4a39-9b51-1f3e5c7d9a20.ics`;
    const put = server.requests.find((request) => request.method === "PUT")!;
    expect(put.url).toBe(url);
    expect(put.headers.get("if-none-match")).toBe("*");
    expect(put.body).toContain("PRODID:-//Gradus//Calendar//EN");
    expect(put.body).toContain("UID:gradus-6f1c2a7e-0d4b-4a39-9b51-1f3e5c7d9a20");
    expect(put.body).toContain("DTSTART:20261110T090000Z\r\n");
    expect(put.body).toContain("DTEND:20261110T100000Z\r\n");
    expect(put.body).toContain("LAST-MODIFIED:20261124T100000Z");
    expect(result).toEqual({
      ok: true,
      meetLink: null,
      event: {
        externalId: url,
        recurringId: url,
        etag: server.resource(new URL(url).pathname)!.etag,
        updatedAt: NOW.toISOString(),
        cancelled: false,
        title: "Schůzka s klientem",
        description: null,
        location: null,
        startsAt: "2026-11-10T09:00:00.000Z",
        endsAt: "2026-11-10T10:00:00.000Z",
        allDay: false,
        transparent: false,
      },
    });
  });

  it("creates an all-day event with an exclusive end day and asks for a missing etag", async () => {
    const { server, provider } = setup();
    server.omitPutEtag = true;
    const result = await provider.putEvent(
      WORK,
      outgoing({
        allDay: true,
        startsAt: "2026-11-02T23:00:00.000Z",
        endsAt: "2026-11-03T23:00:00.000Z",
      }),
      null,
    );
    const put = server.requests.find((request) => request.method === "PUT")!;
    expect(put.body).toContain("DTSTART;VALUE=DATE:20261103\r\n");
    expect(put.body).toContain("DTEND;VALUE=DATE:20261105\r\n");
    expect(result.ok && result.event).toMatchObject({
      allDay: true,
      startsAt: "2026-11-02T23:00:00.000Z",
      endsAt: "2026-11-03T23:00:00.000Z",
      etag: server.resource("/123/calendars/work/6f1c2a7e-0d4b-4a39-9b51-1f3e5c7d9a20.ics")!.etag,
    });
    expect(server.count("PROPFIND", "getetag")).toBe(1);
  });

  it("escapes commas, semicolons and line breaks and reads them back", async () => {
    const { server, provider } = setup();
    const title = "Oběd, porada; plán\nzítra \\ hotovo";
    const result = await provider.putEvent(
      WORK,
      outgoing({ title, location: "Praha, Karlín" }),
      null,
    );
    const put = server.requests.find((request) => request.method === "PUT")!;
    expect(put.body).toContain("SUMMARY:Oběd\\, porada\\; plán\\nzítra \\\\ hotovo");
    expect(put.body).toContain("LOCATION:Praha\\, Karlín");
    expect(result.ok && result.event.title).toBe(title);
    const pulled = await provider.pull(WORK, null, WINDOW);
    expect(pulled.events[0]).toMatchObject({ title, location: "Praha, Karlín" });
  });

  it("folds long lines at 75 octets", async () => {
    const { server, provider } = setup();
    await provider.putEvent(WORK, outgoing({ description: "č".repeat(120) }), null);
    const put = server.requests.find((request) => request.method === "PUT")!;
    for (const line of put.body.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("writes over its own resource when a retried create finds it there", async () => {
    const { server, provider } = setup();
    await provider.putEvent(WORK, outgoing(), null);
    const again = await provider.putEvent(WORK, outgoing({ title: "Znovu" }), null);
    expect(again.ok && again.event.title).toBe("Znovu");
    server.put(
      "/123/calendars/work/foreign.ics",
      cal(ev("UID:someone-else", "DTSTART:20261110T090000Z")),
    );
    const error = await rejection(provider.putEvent(WORK, outgoing({ id: "foreign" }), null));
    expect(error.code).toBe("invalid");
  });

  it("edits a whole resource and keeps its zone, other lines and alarms", async () => {
    const { server, provider } = setup();
    const path = "/123/calendars/work/single.ics";
    server.put(
      path,
      cal(
        PRAGUE_TZ,
        ev(
          "UID:single",
          "SEQUENCE:3",
          "DTSTART;TZID=Europe/Prague:20261105T090000",
          "DURATION:PT30M",
          "SUMMARY:Původní",
          "LOCATION:Staré místo",
          "X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE=Staré místo:geo:50,14",
          "X-CUSTOM:keep me",
          "BEGIN:VALARM",
          "TRIGGER:-PT10M",
          "END:VALARM",
        ),
      ),
    );
    const etag = server.resource(path)!.etag;
    const url = `https://p47-caldav.icloud.com${path}`;
    const result = await provider.putEvent(
      WORK,
      outgoing({
        title: "Nové",
        location: "Nové místo",
        startsAt: "2026-11-05T10:00:00.000Z",
        endsAt: "2026-11-05T11:30:00.000Z",
      }),
      { externalId: url, etag, recurringId: url },
    );
    const put = server.requests.find((request) => request.method === "PUT" && request.url === url)!;
    expect(put.headers.get("if-match")).toBe(etag);
    const stored = server.resource(path)!.data;
    expect(stored).toContain("DTSTART;TZID=Europe/Prague:20261105T110000");
    expect(stored).toContain("DTEND;TZID=Europe/Prague:20261105T123000");
    expect(stored).not.toContain("DURATION");
    expect(stored).not.toContain("X-APPLE-STRUCTURED-LOCATION");
    expect(stored).toContain("X-CUSTOM:keep me");
    expect(stored).toContain("BEGIN:VALARM");
    expect(stored).toContain("BEGIN:VTIMEZONE");
    expect(stored).toContain("SEQUENCE:4");
    expect(result).toMatchObject({
      ok: true,
      event: {
        externalId: url,
        title: "Nové",
        startsAt: "2026-11-05T10:00:00.000Z",
        etag: server.resource(path)!.etag,
      },
    });
  });

  it("answers a stale etag with a conflict and how the event is now", async () => {
    const { server, provider } = setup();
    const path = "/123/calendars/work/c.ics";
    server.put(
      path,
      cal(ev("UID:c", "DTSTART:20261105T090000Z", "DTEND:20261105T100000Z", "SUMMARY:V1")),
    );
    const stale = server.resource(path)!.etag;
    server.put(
      path,
      cal(ev("UID:c", "DTSTART:20261105T090000Z", "DTEND:20261105T100000Z", "SUMMARY:V2")),
    );
    const url = `https://p47-caldav.icloud.com${path}`;
    const result = await provider.putEvent(WORK, outgoing(), {
      externalId: url,
      etag: stale,
      recurringId: url,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      remote: { title: "V2", etag: server.resource(path)!.etag },
    });
    // The etag already differs: no PUT is sent at all.
    expect(server.count("PUT")).toBe(0);
    expect(server.resource(path)!.data).toContain("SUMMARY:V2");
  });

  it("answers a change between reading and writing (412) with a conflict", async () => {
    const { server, provider } = setup();
    const path = "/123/calendars/work/race.ics";
    server.put(
      path,
      cal(ev("UID:race", "DTSTART:20261105T090000Z", "DTEND:20261105T100000Z", "SUMMARY:V1")),
    );
    const etag = server.resource(path)!.etag;
    server.afterGet = () => {
      server.afterGet = null;
      server.put(
        path,
        cal(ev("UID:race", "DTSTART:20261105T090000Z", "DTEND:20261105T100000Z", "SUMMARY:Theirs")),
      );
    };
    const url = `https://p47-caldav.icloud.com${path}`;
    const result = await provider.putEvent(WORK, outgoing(), {
      externalId: url,
      etag,
      recurringId: url,
    });
    expect(result).toMatchObject({ ok: false, reason: "conflict", remote: { title: "Theirs" } });
  });

  it("says gone when the resource was deleted", async () => {
    const { provider } = setup();
    const url = `${WORK}deleted.ics`;
    expect(
      await provider.putEvent(WORK, outgoing(), {
        externalId: url,
        etag: '"e1"',
        recurringId: url,
      }),
    ).toEqual({
      ok: false,
      reason: "gone",
    });
  });

  it("edits one occurrence as an override and leaves the series", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    const etag = server.resource(SERIES_PATH)!.etag;
    const externalId = `${SERIES_URL}#20261102T080000Z`;
    const result = await provider.putEvent(
      WORK,
      outgoing({
        title: "Porada jinde",
        startsAt: "2026-11-02T12:00:00.000Z",
        endsAt: "2026-11-02T13:00:00.000Z",
      }),
      { externalId, etag, recurringId: SERIES_URL },
    );
    expect(result).toMatchObject({
      ok: true,
      event: {
        externalId,
        recurringId: SERIES_URL,
        title: "Porada jinde",
        startsAt: "2026-11-02T12:00:00.000Z",
      },
    });
    const stored = server.resource(SERIES_PATH)!.data;
    expect(stored).toContain("RECURRENCE-ID;TZID=Europe/Prague:20261102T090000");
    expect(stored).toContain("DTSTART;TZID=Europe/Prague:20261102T130000");
    expect(stored.match(/RRULE:FREQ=WEEKLY/g)).toHaveLength(1);
    // The copy keeps the series' alarm and custom lines.
    expect(stored.match(/BEGIN:VALARM/g)).toHaveLength(2);

    const events = byStart((await provider.pull(WORK, null, WINDOW)).events);
    expect(
      events.map((event) => [event.externalId.split("#")[1], event.startsAt, event.title]),
    ).toEqual([
      ["20261012T070000Z", "2026-10-12T07:00:00.000Z", "Porada"],
      ["20261026T080000Z", "2026-10-27T13:00:00.000Z", "Porada (přesunutá)"],
      ["20261102T080000Z", "2026-11-02T12:00:00.000Z", "Porada jinde"],
      ["20261109T080000Z", "2026-11-09T08:00:00.000Z", "Porada"],
    ]);

    // Editing the same occurrence again replaces its override.
    const second = await provider.putEvent(
      WORK,
      outgoing({
        title: "Ještě jinak",
        startsAt: "2026-11-02T14:00:00.000Z",
        endsAt: "2026-11-02T15:00:00.000Z",
      }),
      {
        externalId,
        etag: result.ok ? result.event.etag : null,
        recurringId: SERIES_URL,
      },
    );
    expect(second.ok).toBe(true);
    expect(server.resource(SERIES_PATH)!.data.match(/RECURRENCE-ID/g)).toHaveLength(2);
  });

  it("says gone for an occurrence deleted at Apple", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    const result = await provider.putEvent(WORK, outgoing(), {
      externalId: `${SERIES_URL}#20261019T070000Z`,
      etag: server.resource(SERIES_PATH)!.etag,
      recurringId: SERIES_URL,
    });
    expect(result).toEqual({ ok: false, reason: "gone" });
  });

  it("maps a read-only calendar to forbidden", async () => {
    const { server, provider } = setup();
    const forbidding: Fetcher = async (url, init) =>
      init?.method === "PUT" ? new Response("", { status: 403 }) : server.fetcher(url, init);
    const readOnly = createAppleProvider({
      username: USER,
      password: PASSWORD,
      fetcher: forbidding,
      homeUrl: HOME,
    });
    expect((await rejection(readOnly.putEvent(WORK, outgoing(), null))).code).toBe("forbidden");
    expect(provider.key).toBe("apple");
  });
});

describe("deleteEvent", () => {
  it("deletes one occurrence with an EXDATE and drops its override", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    const etag = server.resource(SERIES_PATH)!.etag;
    await provider.deleteEvent(WORK, {
      externalId: `${SERIES_URL}#20261102T080000Z`,
      etag,
      recurringId: SERIES_URL,
    });
    const put = server.requests.find(
      (request) => request.method === "PUT" && request.url === SERIES_URL,
    )!;
    expect(put.headers.get("if-match")).toBe(etag);
    expect(server.resource(SERIES_PATH)!.data).toContain(
      "EXDATE;TZID=Europe/Prague:20261102T090000",
    );
    expect(await provider.getEvent(WORK, `${SERIES_URL}#20261102T080000Z`)).toBeNull();

    await provider.deleteEvent(WORK, {
      externalId: `${SERIES_URL}#20261026T080000Z`,
      etag: null,
      recurringId: SERIES_URL,
    });
    const stored = server.resource(SERIES_PATH)!.data;
    expect(stored).not.toContain("RECURRENCE-ID");
    const events = byStart((await provider.pull(WORK, null, WINDOW)).events);
    expect(events.map((event) => event.startsAt)).toEqual([
      "2026-10-12T07:00:00.000Z",
      "2026-11-09T08:00:00.000Z",
    ]);
  });

  it("retries an occurrence deletion once after a change in between", async () => {
    const { server, provider } = setup();
    server.put(SERIES_PATH, SERIES);
    server.afterGet = () => {
      server.afterGet = null;
      server.put(SERIES_PATH, SERIES.replace("SUMMARY:Porada\r\n", "SUMMARY:Porada týmu\r\n"));
    };
    await provider.deleteEvent(WORK, {
      externalId: `${SERIES_URL}#20261109T080000Z`,
      etag: null,
      recurringId: SERIES_URL,
    });
    const stored = server.resource(SERIES_PATH)!.data;
    expect(stored).toContain("SUMMARY:Porada týmu");
    expect(stored).toContain("EXDATE;TZID=Europe/Prague:20261109T090000");
    expect(server.count("PUT")).toBe(2);
  });

  it("deletes a single resource with If-Match, and anyway when it changed since", async () => {
    const { server, provider } = setup();
    const path = "/123/calendars/work/single.ics";
    const url = `https://p47-caldav.icloud.com${path}`;
    server.put(path, cal(ev("UID:s", "DTSTART:20261105T090000Z", "SUMMARY:S")));
    const etag = server.resource(path)!.etag;
    await provider.deleteEvent(WORK, { externalId: url, etag, recurringId: url });
    expect(server.resource(path)).toBeUndefined();
    expect(
      server.requests.find((request) => request.method === "DELETE")!.headers.get("if-match"),
    ).toBe(etag);

    server.put(path, cal(ev("UID:s", "DTSTART:20261105T090000Z", "SUMMARY:S2")));
    await provider.deleteEvent(WORK, { externalId: url, etag: '"old"', recurringId: url });
    expect(server.resource(path)).toBeUndefined();

    // Already gone: done.
    await provider.deleteEvent(WORK, { externalId: url, etag: null, recurringId: url });
  });
});

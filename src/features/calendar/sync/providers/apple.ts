import { escapeText, foldLine, icsUtc } from "@/features/scheduler/ics/export";
import {
  icsInstance,
  icsInstances,
  icsRecurrenceKey,
  icsTimeInstant,
  parseIcsProperty,
  parseIcsTime,
  parseRecurrenceKey,
  resolveTimeZone,
  unescapeText,
  unfoldIcsLines,
  type IcsInstance,
  type IcsProperty,
} from "@/features/scheduler/ics/parse";
import { isValidTimeZone, wallOf } from "@/features/scheduler/zoned";
import { APP_NAME } from "@/lib/constants";
import {
  childElements,
  escapeAttribute,
  parseXml,
  textContent,
  type XmlElement,
} from "@/lib/mindmap/formats/xml";
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
 * Apple (iCloud) over CalDAV (28.10). The account connects with its Apple ID
 * and an app-specific password, sent as HTTP Basic with every request, so a
 * request only ever goes to an https host under icloud.com (redirects and
 * hrefs in answers included). CalDAV cannot list what changed: a pull
 * compares the collection's ctag, then the etags of the resources in the
 * window, and reads only the resources whose etag differs. One resource is
 * one event or one whole series; an instance of a series is addressed as
 * `<resource URL>#<RECURRENCE-ID>`.
 */

export const APPLE_CALDAV_ROOT = "https://caldav.icloud.com/";

const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MULTIGET_BATCH = 50;
/** A timed event without an end is written as one hour, like the calendar shows it. */
const DEFAULT_LENGTH_MS = 60 * 60_000;
const CRLF = "\r\n";

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
const NAMESPACES =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" ' +
  'xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"';
const CALENDAR_TYPE = "text/calendar; charset=utf-8";

export type AppleCredentials = { username: string; password: string };

export type AppleDiscovery = { principalUrl: string; homeUrl: string };

export type AppleProviderOptions = AppleCredentials & {
  fetcher: Fetcher;
  /** The calendar home from `discoverApple`; found on first use when missing. */
  homeUrl?: string;
  /** The person's zone: floating times and the days of all-day events. */
  timeZone?: string;
  /** Tests pin the clock written into DTSTAMP and LAST-MODIFIED. */
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Where requests may go
// ---------------------------------------------------------------------------

/** Only iCloud over https, ever: the password goes along with every request. */
export function isAppleUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.endsWith(".icloud.com") &&
    (url.port === "" || url.port === "443") &&
    !url.username &&
    !url.password
  );
}

/** An href of an answer against the address it came from; null when it leaves iCloud. */
function resolveHref(href: string, base: string): string | null {
  try {
    const url = new URL(href.trim(), base);
    url.hash = "";
    return isAppleUrl(url) ? url.href : null;
  } catch {
    return null;
  }
}

const withSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

function collectionUrl(calendarId: string): string {
  const url = resolveHref(calendarId, APPLE_CALDAV_ROOT);
  if (!url || new URL(url).search) throw new ProviderError("invalid");
  return withSlash(url);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type DavAnswer = { status: number; headers: Headers; text: string; url: string };

type SendOptions = {
  depth?: "0" | "1";
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
};

type Dav = (method: string, url: string, options?: SendOptions) => Promise<DavAnswer>;

function basicAuth({ username, password }: AppleCredentials): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** The body up to the cap; a bigger answer is refused, not cut. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderError("invalid", response.status);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderError("invalid", response.status);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("network");
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

function createDav(credentials: AppleCredentials, fetcher: Fetcher): Dav {
  const authorization = basicAuth(credentials);
  return async (method, url, options = {}) => {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Checked before every hop: the credentials never leave iCloud.
      if (!isAppleUrl(current)) throw new ProviderError("invalid");
      const headers: Record<string, string> = { Authorization: authorization, ...options.headers };
      if (options.depth) headers.Depth = options.depth;
      if (options.body !== undefined) {
        headers["Content-Type"] = options.contentType ?? 'application/xml; charset="utf-8"';
      }
      let response: Response;
      try {
        response = await fetcher(current, {
          method,
          headers,
          body: options.body,
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // Never the error itself: it could carry the request.
        throw new ProviderError("network");
      }
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        const next = location ? resolveHref(location, current) : null;
        if (!next) throw new ProviderError("invalid", response.status);
        current = next;
        continue;
      }
      return {
        status: response.status,
        headers: response.headers,
        text: await readCapped(response),
        url: current,
      };
    }
    throw new ProviderError("invalid");
  };
}

const isOk = (status: number) => status >= 200 && status < 300;
const isGone = (status: number) => status === 404 || status === 410;

function fail(status: number): never {
  throw new ProviderError(codeOfStatus(status), status);
}

// ---------------------------------------------------------------------------
// WebDAV answers
// ---------------------------------------------------------------------------

type DavEntry = { href: string; status: number | null; props: Map<string, XmlElement> };

function statusOf(element: XmlElement | undefined): number | null {
  if (!element) return null;
  const match = /HTTP\/[\d.]+\s+(\d{3})/.exec(textContent(element));
  return match ? Number(match[1]) : null;
}

/** The responses of a 207 Multi-Status; prefixes differ by server, names are local. */
function parseMultistatus(text: string, base: string): DavEntry[] {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch {
    throw new ProviderError("invalid");
  }
  if (root.name !== "multistatus") throw new ProviderError("invalid");
  const entries: DavEntry[] = [];
  for (const response of childElements(root, "response")) {
    const hrefElement = childElements(response, "href")[0];
    const href = hrefElement ? resolveHref(textContent(hrefElement), base) : null;
    // Anything outside iCloud is not ours to read.
    if (!href) continue;
    const props = new Map<string, XmlElement>();
    for (const propstat of childElements(response, "propstat")) {
      const status = statusOf(childElements(propstat, "status")[0]);
      if (status !== null && !isOk(status)) continue;
      for (const prop of childElements(propstat, "prop")) {
        for (const element of childElements(prop)) props.set(element.name, element);
      }
    }
    entries.push({ href, status: statusOf(childElements(response, "status")[0]), props });
  }
  return entries;
}

function propText(entry: DavEntry | undefined, name: string): string | null {
  const element = entry?.props.get(name);
  if (!element) return null;
  const text = textContent(element).trim();
  return text || null;
}

function sameUrl(a: string, b: string): boolean {
  return withSlash(a) === withSlash(b);
}

/** The entry that answers for `url` itself (Depth 0), else the first. */
function selfEntry(entries: DavEntry[], url: string): DavEntry | undefined {
  return entries.find((entry) => sameUrl(entry.href, url)) ?? entries[0];
}

/** The href inside a property (current-user-principal, calendar-home-set). */
function linkedHref(answer: DavAnswer, prop: string): string {
  for (const entry of parseMultistatus(answer.text, answer.url)) {
    const element = entry.props.get(prop);
    const href = element ? childElements(element, "href")[0] : undefined;
    if (!href) continue;
    const url = resolveHref(textContent(href), answer.url);
    // A home outside iCloud is never followed.
    if (!url) throw new ProviderError("invalid");
    return url;
  }
  throw new ProviderError("invalid");
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const PRINCIPAL_BODY = `${XML_HEAD}<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const HOME_BODY = `${XML_HEAD}<d:propfind ${NAMESPACES}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

/**
 * Checks the Apple ID and app-specific password and finds the calendar home
 * (often on another iCloud host, p47-caldav.icloud.com). A wrong password
 * throws ProviderError("auth").
 */
export async function discoverApple(
  credentials: AppleCredentials,
  fetcher: Fetcher,
): Promise<AppleDiscovery> {
  const dav = createDav(credentials, fetcher);
  const root = await dav("PROPFIND", APPLE_CALDAV_ROOT, { depth: "0", body: PRINCIPAL_BODY });
  if (!isOk(root.status)) fail(root.status);
  const principalUrl = linkedHref(root, "current-user-principal");
  const principal = await dav("PROPFIND", principalUrl, { depth: "0", body: HOME_BODY });
  if (!isOk(principal.status)) fail(principal.status);
  return { principalUrl, homeUrl: withSlash(linkedHref(principal, "calendar-home-set")) };
}

// ---------------------------------------------------------------------------
// iCalendar resources, edited line by line
// ---------------------------------------------------------------------------

type Component = { name: string; items: (string | Component)[] };

/** The VCALENDAR of a resource as a tree; unknown lines are kept as they are. */
function parseCalendar(text: string): Component | null {
  const root: Component = { name: "#root", items: [] };
  const stack: Component[] = [root];
  for (const line of unfoldIcsLines(text)) {
    if (!line.trim()) continue;
    const top = stack[stack.length - 1];
    const property = parseIcsProperty(line);
    if (property?.name === "BEGIN") {
      const component: Component = { name: property.value.toUpperCase(), items: [] };
      top.items.push(component);
      stack.push(component);
      continue;
    }
    if (property?.name === "END") {
      if (stack.length < 2 || top.name !== property.value.toUpperCase()) return null;
      stack.pop();
      continue;
    }
    top.items.push(line);
  }
  if (stack.length !== 1) return null;
  const calendar = root.items.find(
    (item): item is Component => typeof item !== "string" && item.name === "VCALENDAR",
  );
  return calendar ?? null;
}

function serializeLines(component: Component): string[] {
  const lines = [`BEGIN:${component.name}`];
  for (const item of component.items) {
    if (typeof item === "string") lines.push(foldLine(item));
    else lines.push(...serializeLines(item));
  }
  lines.push(`END:${component.name}`);
  return lines;
}

const serialize = (calendar: Component) => serializeLines(calendar).join(CRLF) + CRLF;

const nameOf = (line: string) => parseIcsProperty(line)?.name ?? "";

function components(parent: Component, name: string): Component[] {
  return parent.items.filter(
    (item): item is Component => typeof item !== "string" && item.name === name,
  );
}

function firstProp(component: Component, name: string): IcsProperty | undefined {
  for (const item of component.items) {
    if (typeof item !== "string") continue;
    const property = parseIcsProperty(item);
    if (property?.name === name) return property;
  }
  return undefined;
}

/** Replaces every line of a property with `lines` at the place of the first (else at the end). */
function setProp(component: Component, name: string, lines: readonly string[]): void {
  const out: (string | Component)[] = [];
  let placed = false;
  for (const item of component.items) {
    if (typeof item === "string" && nameOf(item) === name) {
      if (!placed) out.push(...lines);
      placed = true;
      continue;
    }
    out.push(item);
  }
  if (!placed) {
    // Properties go before sub-components (VALARM).
    const firstComponent = out.findIndex((item) => typeof item !== "string");
    if (firstComponent < 0) out.push(...lines);
    else out.splice(firstComponent, 0, ...lines);
  }
  component.items = out;
}

/** Adds one more line of a property (EXDATE) after its last one. */
function addProp(component: Component, line: string): void {
  const name = nameOf(line);
  let last = -1;
  component.items.forEach((item, index) => {
    if (typeof item === "string" && nameOf(item) === name) last = index;
  });
  if (last >= 0) component.items.splice(last + 1, 0, line);
  else setProp(component, name, [line]);
}

function cloneComponent(component: Component): Component {
  return {
    name: component.name,
    items: component.items.map((item) => (typeof item === "string" ? item : cloneComponent(item))),
  };
}

/** How the master's times are written: a zone's wall clock, floating, or null = UTC. */
type Shape = { tzid: string | null; zone: string };

function wallShape(vevent: Component, defaultZone: string): Shape | null {
  const start = firstProp(vevent, "DTSTART");
  if (!start || start.params.VALUE === "DATE") return null;
  const time = parseIcsTime(start.value, start.params);
  if (!time || time.kind !== "local") return null;
  if (!start.params.TZID) return { tzid: null, zone: defaultZone };
  const zone = resolveTimeZone(start.params.TZID);
  return zone ? { tzid: start.params.TZID, zone } : null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const compactDay = (day: string) => day.replace(/-/g, "");

function localStamp(instant: number, zone: string): string {
  const wall = wallOf(instant, zone);
  return `${String(wall.year).padStart(4, "0")}${pad(wall.month)}${pad(wall.day)}T${pad(wall.hour)}${pad(wall.minute)}00`;
}

function tzParam(shape: Shape): string {
  if (shape.tzid === null) return "";
  return /[:;,"]/.test(shape.tzid)
    ? `;TZID="${shape.tzid.replace(/"/g, "")}"`
    : `;TZID=${shape.tzid}`;
}

/** A timed instant in the master's shape. */
function timeValue(property: string, instant: number, shape: Shape | null): string {
  if (shape) return `${property}${tzParam(shape)}:${localStamp(instant, shape.zone)}`;
  return `${property}:${icsUtc(new Date(instant))}`;
}

function eventZone(event: OutgoingEvent, fallback: string): string {
  return isValidTimeZone(event.timeZone) ? event.timeZone : fallback;
}

function timeLines(event: OutgoingEvent, shape: Shape | null, zone: string): [string, string] {
  if (event.allDay) {
    const { start, endExclusive } = allDayDays(
      event.startsAt,
      event.endsAt,
      eventZone(event, zone),
    );
    return [
      `DTSTART;VALUE=DATE:${compactDay(start)}`,
      `DTEND;VALUE=DATE:${compactDay(endExclusive)}`,
    ];
  }
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) throw new ProviderError("invalid");
  const parsedEnd = event.endsAt ? Date.parse(event.endsAt) : Number.NaN;
  const end =
    Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + DEFAULT_LENGTH_MS;
  return [timeValue("DTSTART", start, shape), timeValue("DTEND", end, shape)];
}

/** The RECURRENCE-ID or EXDATE of an occurrence, written like the master's DTSTART. */
function occurrenceLine(
  property: "RECURRENCE-ID" | "EXDATE",
  key: string,
  master: Component | undefined,
  zone: string,
): string {
  const time = parseRecurrenceKey(key);
  if (!time) throw new ProviderError("invalid");
  if (time.kind === "date") return `${property};VALUE=DATE:${key}`;
  const instant = icsTimeInstant(time, zone);
  return timeValue(property, instant, master ? wallShape(master, zone) : null);
}

function matchesKey(vevent: Component, key: string, zone: string): boolean {
  const id = firstProp(vevent, "RECURRENCE-ID");
  if (!id) return false;
  const time = parseIcsTime(id.value, id.params);
  return time !== null && icsRecurrenceKey(time, zone) === key;
}

function bump(vevent: Component, now: Date): void {
  const stamp = icsUtc(now);
  setProp(vevent, "DTSTAMP", [`DTSTAMP:${stamp}`]);
  setProp(vevent, "LAST-MODIFIED", [`LAST-MODIFIED:${stamp}`]);
  const sequence = Number(firstProp(vevent, "SEQUENCE")?.value);
  const next = Number.isInteger(sequence) && sequence >= 0 ? sequence + 1 : 1;
  setProp(vevent, "SEQUENCE", [`SEQUENCE:${next}`]);
}

/** A text property, rewritten only when the text changed (keeps the server's own lines). */
function setText(vevent: Component, name: string, value: string | null): boolean {
  const current = firstProp(vevent, name);
  const before = current ? unescapeText(current.value) : null;
  const after = value === null || value === "" ? null : value;
  if (before === after) return false;
  setProp(vevent, name, after === null ? [] : [`${name}:${escapeText(after)}`]);
  return true;
}

function applyFields(
  vevent: Component,
  event: OutgoingEvent,
  shape: Shape | null,
  zone: string,
  now: Date,
): void {
  setText(vevent, "SUMMARY", event.title);
  setText(vevent, "DESCRIPTION", event.description);
  // Apple shows the structured location over LOCATION; a stale one must go.
  if (setText(vevent, "LOCATION", event.location)) {
    setProp(vevent, "X-APPLE-STRUCTURED-LOCATION", []);
  }
  const [start, end] = timeLines(event, event.allDay ? null : shape, zone);
  setProp(vevent, "DTSTART", [start]);
  setProp(vevent, "DTEND", [end]);
  setProp(vevent, "DURATION", []);
  bump(vevent, now);
}

const uidOfEvent = (id: string) => `gradus-${id.replace(/[^\w.@-]/g, "").slice(0, 200)}`;

function resourceName(id: string): string {
  const name = id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 100);
  if (!name) throw new ProviderError("invalid");
  return `${name}.ics`;
}

function newCalendar(event: OutgoingEvent, zone: string, now: Date): string {
  const stamp = icsUtc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Calendar//EN`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uidOfEvent(event.id)}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    "SEQUENCE:0",
    ...timeLines(event, null, zone),
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

function toRemote(
  url: string,
  etag: string | null,
  instance: IcsInstance,
  zone: string,
  externalId?: string,
): RemoteEvent {
  const times =
    instance.allDay && instance.startDay
      ? allDayInstants(instance.startDay, instance.endDay, zone)
      : {
          startsAt: iso(instance.start),
          endsAt: instance.end > instance.start ? iso(instance.end) : null,
        };
  return {
    externalId: externalId ?? (instance.recurrenceKey ? `${url}#${instance.recurrenceKey}` : url),
    recurringId: url,
    etag,
    updatedAt: instance.lastModified !== null ? iso(instance.lastModified) : null,
    cancelled: false,
    title: instance.summary,
    description: instance.description,
    location: instance.location,
    ...times,
    allDay: instance.allDay,
    transparent: instance.transparent,
  };
}

/** A link's resource URL (inside the calendar) and the occurrence key, if any. */
function splitTarget(collection: string, externalId: string): { url: string; key: string | null } {
  const hash = externalId.indexOf("#");
  const raw = hash >= 0 ? externalId.slice(0, hash) : externalId;
  const key = hash >= 0 ? externalId.slice(hash + 1) : null;
  const url = resolveHref(raw, collection);
  if (!url || !url.startsWith(collection) || sameUrl(url, collection)) {
    throw new ProviderError("invalid");
  }
  if (key !== null && !parseRecurrenceKey(key)) throw new ProviderError("invalid");
  return { url, key };
}

const chunk = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
};

const CTAG_BODY = `${XML_HEAD}<d:propfind ${NAMESPACES}><d:prop><cs:getctag/></d:prop></d:propfind>`;
const ETAG_BODY = `${XML_HEAD}<d:propfind ${NAMESPACES}><d:prop><d:getetag/></d:prop></d:propfind>`;
const CALENDARS_BODY =
  `${XML_HEAD}<d:propfind ${NAMESPACES}><d:prop><d:resourcetype/><d:displayname/>` +
  "<cs:getctag/><c:supported-calendar-component-set/><d:current-user-privilege-set/>" +
  "<a:calendar-order/></d:prop></d:propfind>";

/** The collection's own name from its address, for a calendar without a display name. */
function lastSegment(url: string): string {
  const raw = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const WRITE_PRIVILEGES = new Set(["write", "write-content", "all"]);

export function createAppleProvider(options: AppleProviderOptions): CalendarProvider {
  const dav = createDav(options, options.fetcher);
  const zone = options.timeZone && isValidTimeZone(options.timeZone) ? options.timeZone : "UTC";
  const clock = options.now ?? (() => new Date());
  let home: string | null = options.homeUrl ? collectionUrl(options.homeUrl) : null;

  async function homeUrl(): Promise<string> {
    home ??= (await discoverApple(options, options.fetcher)).homeUrl;
    return home;
  }

  async function fetchEtag(url: string): Promise<string | null> {
    const answer = await dav("PROPFIND", url, { depth: "0", body: ETAG_BODY });
    if (!isOk(answer.status)) return null;
    return propText(selfEntry(parseMultistatus(answer.text, answer.url), url), "getetag");
  }

  /** Every resource with an event in the window and its etag. */
  async function queryEtags(collection: string, window: SyncWindow): Promise<Map<string, string>> {
    const body =
      `${XML_HEAD}<c:calendar-query ${NAMESPACES}><d:prop><d:getetag/></d:prop>` +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
      `<c:time-range start="${icsUtc(new Date(window.from))}" end="${icsUtc(new Date(window.to))}"/>` +
      "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
    const answer = await dav("REPORT", collection, { depth: "1", body });
    if (!isOk(answer.status)) fail(answer.status);
    const listed = new Map<string, string>();
    for (const entry of parseMultistatus(answer.text, answer.url)) {
      if (sameUrl(entry.href, collection) || !entry.href.startsWith(collection)) continue;
      if (entry.status !== null && !isOk(entry.status)) continue;
      listed.set(entry.href, propText(entry, "getetag") ?? "");
    }
    return listed;
  }

  /** The etag (and with `withData` the text) of resources; missing ones are absent. */
  async function multiget(
    collection: string,
    hrefs: readonly string[],
    withData: boolean,
  ): Promise<Map<string, { etag: string | null; data: string | null }>> {
    const origin = new URL(collection).origin;
    const found = new Map<string, { etag: string | null; data: string | null }>();
    const paths = hrefs.filter((href) => new URL(href).origin === origin);
    for (const batch of chunk(paths, MULTIGET_BATCH)) {
      const body =
        `${XML_HEAD}<c:calendar-multiget ${NAMESPACES}><d:prop><d:getetag/>` +
        `${withData ? "<c:calendar-data/>" : ""}</d:prop>` +
        batch
          .map((href) => `<d:href>${escapeAttribute(new URL(href).pathname)}</d:href>`)
          .join("") +
        "</c:calendar-multiget>";
      const answer = await dav("REPORT", collection, { depth: "1", body });
      if (!isOk(answer.status)) fail(answer.status);
      for (const entry of parseMultistatus(answer.text, answer.url)) {
        if (entry.status !== null && !isOk(entry.status)) continue;
        const etag = propText(entry, "getetag");
        const dataElement = entry.props.get("calendar-data");
        const data = dataElement ? textContent(dataElement) : null;
        if (etag === null && data === null) continue;
        if (withData && data === null) continue;
        found.set(entry.href, { etag, data });
      }
    }
    return found;
  }

  async function getEvent(calendarId: string, externalId: string): Promise<RemoteEvent | null> {
    const collection = collectionUrl(calendarId);
    const { url, key } = splitTarget(collection, externalId);
    const answer = await dav("GET", url);
    if (isGone(answer.status)) return null;
    if (!isOk(answer.status)) fail(answer.status);
    const instance = icsInstance(answer.text, key, zone);
    if (!instance) return null;
    const etag = answer.headers.get("etag") ?? (await fetchEtag(url));
    return toRemote(url, etag, instance, zone);
  }

  async function conflict(calendarId: string, externalId: string): Promise<PutResult> {
    return { ok: false, reason: "conflict", remote: await getEvent(calendarId, externalId) };
  }

  /** Writes the text and answers with the stored event (its etag from the answer or asked for). */
  async function written(
    url: string,
    text: string,
    key: string | null,
    putAnswer: DavAnswer,
  ): Promise<PutResult> {
    const etag = putAnswer.headers.get("etag") ?? (await fetchEtag(url));
    const instance = icsInstance(text, key, zone);
    if (!instance) throw new ProviderError("invalid");
    return {
      ok: true,
      event: toRemote(url, etag, instance, zone, key ? `${url}#${key}` : url),
      meetLink: null,
    };
  }

  async function createEvent(
    calendarId: string,
    collection: string,
    event: OutgoingEvent,
  ): Promise<PutResult> {
    const url = `${collection}${resourceName(event.id)}`;
    const text = newCalendar(event, zone, clock());
    const answer = await dav("PUT", url, {
      body: text,
      contentType: CALENDAR_TYPE,
      headers: { "If-None-Match": "*" },
    });
    if (answer.status === 412) {
      // Already there: a retry after a lost answer. Ours (same UID) is written over.
      const existing = await dav("GET", url);
      const uid = isOk(existing.status) ? icsInstance(existing.text, null, zone)?.uid : null;
      if (uid !== uidOfEvent(event.id)) throw new ProviderError("invalid", 412);
      const target = { externalId: url, etag: existing.headers.get("etag"), recurringId: url };
      return updateEvent(calendarId, collection, event, target);
    }
    if (!isOk(answer.status)) fail(answer.status);
    return written(url, text, null, answer);
  }

  async function updateEvent(
    calendarId: string,
    collection: string,
    event: OutgoingEvent,
    target: LinkTarget,
  ): Promise<PutResult> {
    const { url, key } = splitTarget(collection, target.externalId);
    const current = await dav("GET", url);
    if (isGone(current.status)) return { ok: false, reason: "gone" };
    if (!isOk(current.status)) fail(current.status);
    const currentEtag = current.headers.get("etag");
    // Changed since our etag: the PUT would only be refused.
    if (target.etag && currentEtag && target.etag !== currentEtag) {
      return conflict(calendarId, target.externalId);
    }
    const calendar = parseCalendar(current.text);
    if (!calendar) throw new ProviderError("invalid");
    const vevents = components(calendar, "VEVENT");
    const master = vevents.find((vevent) => !firstProp(vevent, "RECURRENCE-ID"));
    const now = clock();

    if (key === null) {
      const main = master ?? vevents[0];
      if (!main) return { ok: false, reason: "gone" };
      applyFields(main, event, wallShape(main, zone), zone, now);
    } else {
      // An occurrence deleted at Apple is gone, not brought back by an override.
      if (!icsInstance(current.text, key, zone)) return { ok: false, reason: "gone" };
      let override = vevents.find((vevent) => matchesKey(vevent, key, zone));
      if (!override) {
        if (!master) return { ok: false, reason: "gone" };
        // Like Apple: the occurrence starts as a copy of the series (alarms, attendees).
        override = cloneComponent(master);
        for (const name of ["RRULE", "RDATE", "EXDATE", "EXRULE"]) setProp(override, name, []);
        setProp(override, "RECURRENCE-ID", [occurrenceLine("RECURRENCE-ID", key, master, zone)]);
        calendar.items.splice(calendar.items.indexOf(master) + 1, 0, override);
      }
      const shape = wallShape(master ?? override, zone);
      applyFields(override, event, shape, zone, now);
    }

    const text = serialize(calendar);
    const ifMatch = target.etag ?? currentEtag;
    const answer = await dav("PUT", url, {
      body: text,
      contentType: CALENDAR_TYPE,
      headers: ifMatch ? { "If-Match": ifMatch } : {},
    });
    if (answer.status === 412) return conflict(calendarId, target.externalId);
    if (isGone(answer.status)) return { ok: false, reason: "gone" };
    if (!isOk(answer.status)) fail(answer.status);
    return written(url, text, key, answer);
  }

  async function deleteResource(url: string, etag: string | null): Promise<void> {
    const answer = await dav("DELETE", url, { headers: etag ? { "If-Match": etag } : {} });
    if (answer.status === 412) {
      // Changed at Apple since: deleting in Gradus wins like the newer change.
      const again = await dav("DELETE", url);
      if (isOk(again.status) || isGone(again.status)) return;
      fail(again.status);
    }
    if (isOk(answer.status) || isGone(answer.status)) return;
    fail(answer.status);
  }

  /** One occurrence out of a series: an EXDATE on the master, its override dropped. */
  async function deleteOccurrence(url: string, key: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await dav("GET", url);
      if (isGone(current.status)) return;
      if (!isOk(current.status)) fail(current.status);
      const etag = current.headers.get("etag");
      const calendar = parseCalendar(current.text);
      if (!calendar) throw new ProviderError("invalid");
      const vevents = components(calendar, "VEVENT");
      const master = vevents.find((vevent) => !firstProp(vevent, "RECURRENCE-ID"));
      const overrides = vevents.filter(
        (vevent) => vevent !== master && matchesKey(vevent, key, zone),
      );
      if (!overrides.length && !icsInstance(current.text, key, zone)) return;
      calendar.items = calendar.items.filter(
        (item) => typeof item === "string" || !overrides.includes(item),
      );
      if (!master) {
        // A resource with only this occurrence (an invitation to one): nothing is left.
        if (!components(calendar, "VEVENT").length) return deleteResource(url, etag);
      } else {
        addProp(master, occurrenceLine("EXDATE", key, master, zone));
        bump(master, clock());
      }
      const answer = await dav("PUT", url, {
        body: serialize(calendar),
        contentType: CALENDAR_TYPE,
        headers: etag ? { "If-Match": etag } : {},
      });
      if (answer.status === 412) continue;
      if (isOk(answer.status) || isGone(answer.status)) return;
      fail(answer.status);
    }
    throw new ProviderError("unknown", 412);
  }

  return {
    key: "apple",

    async listCalendars(): Promise<RemoteCalendar[]> {
      const base = await homeUrl();
      const answer = await dav("PROPFIND", base, { depth: "1", body: CALENDARS_BODY });
      if (!isOk(answer.status)) fail(answer.status);
      const found: (RemoteCalendar & { order: number })[] = [];
      for (const entry of parseMultistatus(answer.text, answer.url)) {
        if (sameUrl(entry.href, base)) continue;
        const type = entry.props.get("resourcetype");
        if (!type || !childElements(type, "calendar").length) continue;
        // A list without VEVENT is Reminders (VTODO); no list = every component.
        const set = entry.props.get("supported-calendar-component-set");
        if (set) {
          const kinds = childElements(set, "comp").map((comp) =>
            (comp.attributes.name ?? "").toUpperCase(),
          );
          if (!kinds.includes("VEVENT")) continue;
        }
        const privileges = entry.props.get("current-user-privilege-set");
        const canWrite = privileges
          ? childElements(privileges, "privilege").some((privilege) =>
              childElements(privilege).some((element) => WRITE_PRIVILEGES.has(element.name)),
            )
          : true;
        const externalId = withSlash(entry.href);
        const segment = lastSegment(externalId);
        const order = Number(propText(entry, "calendar-order"));
        found.push({
          externalId,
          name: propText(entry, "displayname") ?? segment,
          isPrimary: false,
          canWrite,
          order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
        });
      }
      found.sort((a, b) => a.order - b.order);
      // The old default calendar is ".../home/"; otherwise the first writable in Apple's order.
      const primary =
        found.find((calendar) => calendar.canWrite && /\/home\/$/.test(calendar.externalId)) ??
        found.find((calendar) => calendar.canWrite);
      return found.map((calendar) => ({
        externalId: calendar.externalId,
        name: calendar.name,
        isPrimary: calendar === primary,
        canWrite: calendar.canWrite,
      }));
    },

    async pull(calendarId, state, window, known): Promise<PullResult> {
      const collection = collectionUrl(calendarId);
      const ctagAnswer = await dav("PROPFIND", collection, { depth: "0", body: CTAG_BODY });
      if (!isOk(ctagAnswer.status)) fail(ctagAnswer.status);
      const ctag = propText(
        selfEntry(parseMultistatus(ctagAnswer.text, ctagAnswer.url), collection),
        "getctag",
      );
      if (ctag && state && ctag === state) {
        return {
          full: false,
          events: [],
          removed: [],
          removedSeries: [],
          completeSeries: [],
          state,
        };
      }

      const listed = await queryEtags(collection, window);
      const toRead = new Set<string>();
      for (const [href, etag] of listed) {
        if (!known || known.get(href) !== etag) toRead.add(href);
      }
      const removedSeries = new Set<string>();
      if (known) {
        // Known but not in the window: deleted, or moved out of it (then read again).
        const missing = [...known.keys()].filter(
          (href) => !listed.has(href) && href.startsWith(collection),
        );
        if (missing.length) {
          const still = await multiget(collection, missing, false);
          for (const href of missing) {
            const found = still.get(href);
            if (!found) removedSeries.add(href);
            else if (found.etag !== known.get(href)) toRead.add(href);
          }
        }
      }

      const read = toRead.size
        ? await multiget(collection, [...toRead], true)
        : new Map<string, { etag: string | null; data: string | null }>();
      const events: RemoteEvent[] = [];
      const completeSeries: string[] = [];
      for (const href of toRead) {
        const resource = read.get(href);
        if (!resource || resource.data === null) {
          // Deleted between the two requests.
          if (known?.has(href)) removedSeries.add(href);
          continue;
        }
        completeSeries.push(href);
        const instances = icsInstances(resource.data, {
          from: window.from,
          to: window.to,
          defaultTimeZone: zone,
        });
        for (const instance of instances)
          events.push(toRemote(href, resource.etag, instance, zone));
      }
      return {
        full: !known,
        events,
        removed: [],
        removedSeries: [...removedSeries],
        completeSeries,
        state: ctag,
      };
    },

    getEvent,

    async putEvent(calendarId, event, target): Promise<PutResult> {
      const collection = collectionUrl(calendarId);
      if (!target) return createEvent(calendarId, collection, event);
      return updateEvent(calendarId, collection, event, target);
    },

    async deleteEvent(calendarId, target): Promise<void> {
      const collection = collectionUrl(calendarId);
      const { url, key } = splitTarget(collection, target.externalId);
      if (key === null) return deleteResource(url, target.etag);
      return deleteOccurrence(url, key);
    },
  };
}

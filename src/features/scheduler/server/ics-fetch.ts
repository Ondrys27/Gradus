import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Downloading a subscribed calendar. The address is the user's secret (it
 * opens their whole calendar), so it is never logged, and it is someone
 * else's server, so the request is fenced in: https only, public addresses
 * only (checked again after every redirect), at most three redirects, ten
 * seconds and five megabytes.
 */

export const ICS_TIMEOUT_MS = 10_000;
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
const MAX_URL_LENGTH = 2000;
const MAX_REDIRECTS = 3;

export type NormalizedUrl =
  | { ok: true; url: string; hint: string }
  | { ok: false; reason: "invalid" | "notHttps" | "blocked" };

export type FetchIcsResult =
  | { ok: true; text: string }
  | {
      ok: false;
      code: "invalid" | "blocked" | "timeout" | "tooLarge" | "http" | "notCalendar" | "network";
      status?: number;
    };

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

function publicIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  // An IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (tail) {
    const v4 = ipv4Parts(tail[1]);
    if (!v4) return null;
    address =
      address.slice(0, -tail[1].length) +
      `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** Whether an IP address is on the public internet (not private, loopback, link-local…). */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]);
  if (version === 4) {
    const parts = ipv4Parts(ip);
    return parts !== null && publicIpv4(parts);
  }
  if (version !== 6) return false;
  const g = ipv6Groups(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  const embedded = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return publicIpv4(embedded);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return publicIpv4(embedded);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // discard
  return true;
}

/** A pasted address as the server fetches it, or why not. */
export function normalizeIcsUrl(input: string): NormalizedUrl {
  const trimmed = (input ?? "").trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "invalid" };
  const rewritten = trimmed.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(rewritten);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "notHttps" };
  if (url.username || url.password) return { ok: false, reason: "invalid" };
  if (url.port && url.port !== "443") return { ok: false, reason: "blocked" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "invalid" };
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (!isPublicAddress(bare)) return { ok: false, reason: "blocked" };
  } else if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  ) {
    return { ok: false, reason: "blocked" };
  }
  url.hash = "";
  return { ok: true, url: url.toString(), hint: host.replace(/^www\./, "") };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type Lookup = (host: string) => Promise<string[]>;

const defaultLookup: Lookup = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

const HEADERS = {
  accept: "text/calendar, */*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; CalendarFetcher/1.0)",
};

class Stop extends Error {
  constructor(readonly result: FetchIcsResult) {
    super(result.ok ? "ok" : result.code);
  }
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Stop({ ok: false, code: "tooLarge" });
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Stop({ ok: false, code: "tooLarge" });
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

/** Downloads an ICS feed within the fences above. Never throws, never logs the address. */
export async function fetchIcs(
  url: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    lookup?: Lookup;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<FetchIcsResult> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? ICS_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? ICS_MAX_BYTES;
  const lookup = options.lookup ?? defaultLookup;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const normalized = normalizeIcsUrl(current);
      if (!normalized.ok) {
        return { ok: false, code: normalized.reason === "blocked" ? "blocked" : "invalid" };
      }
      const host = new URL(normalized.url).hostname.replace(/^\[|\]$/g, "");
      if (!isIP(host)) {
        let addresses: string[];
        try {
          addresses = await untilAborted(lookup(host), signal);
        } catch (error) {
          if (signal.aborted) throw error;
          return { ok: false, code: "network" };
        }
        if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
          return { ok: false, code: "blocked" };
        }
      }
      const response = await fetchImpl(normalized.url, {
        redirect: "manual",
        signal,
        headers: HEADERS,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) return { ok: false, code: "http", status: response.status };
        try {
          current = new URL(location, normalized.url).toString();
        } catch {
          return { ok: false, code: "invalid" };
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, code: "http", status: response.status };
      }
      const text = await readBody(response, maxBytes);
      if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, code: "notCalendar" };
      return { ok: true, text };
    }
    // Too many redirects.
    return { ok: false, code: "http" };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    if (signal.aborted) return { ok: false, code: "timeout" };
    const name = (error as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, code: "timeout" };
    return { ok: false, code: "network" };
  }
}

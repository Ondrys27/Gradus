import { browserOf, deviceOf } from "@/lib/analytics/device";

/**
 * What the history of an administrator keeps about a sign-in: the address
 * cut to its network (IPv4 /24, IPv6 /48) and the browser with the kind of
 * device. Never the full address, never the User-Agent string.
 */

export function truncateIp(ip: string | null | undefined): string | null {
  const value = (ip ?? "").trim().toLowerCase();
  const v4 = value.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1, 4).map(Number);
    if (parts.some((part) => part > 255) || Number(v4[4]) > 255) return null;
    return `${parts.join(".")}.0/24`;
  }
  if (!value.includes(":") || !/^[0-9a-f:]+$/.test(value)) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((group) => group.length === 0 || group.length > 4)) return null;
  return `${groups
    .slice(0, 3)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/48`;
}

/** "chrome/desktop": the same classes as the analytics, from the User-Agent. */
export function browserLabel(userAgent: string | null | undefined): string {
  return `${browserOf(userAgent)}/${deviceOf(userAgent)}`;
}

/** Back to the two keys under admin.browser / admin.device for display. */
export function splitBrowserLabel(label: string | null): { browser: string; device: string } | null {
  const match = label?.match(/^([a-z]+)\/([a-z]+)$/);
  return match ? { browser: match[1], device: match[2] } : null;
}

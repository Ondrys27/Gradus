import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";

function fingerprintKey(): string {
  // The secret key never leaves the server, so nobody can rebuild an address from its fingerprint.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return key;
}

/** A keyed hash, short enough to read in the audit, never the value itself. */
export function fingerprint(kind: "ip" | "email", value: string): string {
  return createHmac("sha256", fingerprintKey())
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

/** The visitor's address as Vercel passes it on, and the browser's description. */
export async function requestInfo(): Promise<{ ip: string; userAgent: string | null }> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || list.get("x-real-ip")?.trim() || "unknown";
  return { ip, userAgent: list.get("user-agent") };
}

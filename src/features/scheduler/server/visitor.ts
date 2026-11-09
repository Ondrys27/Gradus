import "server-only";
import { fingerprint, requestInfo } from "@/features/admin/server/request-info";

/**
 * The booking page's visitor, for the hourly limits only: a keyed hash of
 * their address (never the address). Outside production the end-to-end
 * tests tell their browsers apart with a header of their own.
 */
export const E2E_VISITOR_HEADER = "x-gradus-e2e-visitor";

export async function visitorHash(request: Request): Promise<string> {
  const { ip } = await requestInfo();
  const e2e =
    process.env.VERCEL_ENV !== "production" ? request.headers.get(E2E_VISITOR_HEADER) : null;
  const tag = e2e && /^[a-z0-9-]{1,40}$/i.test(e2e) ? `:${e2e}` : "";
  return fingerprint("ip", `${ip}${tag}`);
}
